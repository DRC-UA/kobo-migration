import {PromisePool} from '@supercharge/promise-pool'
import {Kobo, KoboClient} from 'kobo-sdk'
import {duration, Obj, seq, sleep} from '@alexandreannic/ts-utils'
import {createSpinner} from 'nanospinner'
import {makeProgress, makeProgressAndPercent, makeStepper, truncateString} from './utils'
import * as c from 'ansi-colors'
import {subDays} from 'date-fns'

export const migrate = async ({
  source,
  migratedAnswerTag,
  destination,
  filters,
  dryRun,
}: {
  filters: {
    formIdsIgnored?: Kobo.FormId[]
    formIds?: Kobo.FormId[]
    submissionDateStart?: Date
    submissionDateEnd?: Date
    take?: number
    offset?: number
  } & (
    | {
    formIdsIgnored?: Kobo.FormId[]
    formIds?: never
  }
    | {
    formIdsIgnored?: never
    formIds?: Kobo.FormId[]
  }
    )
  /** @deprecated Not implemented yet*/
  migratedAnswerTag?: string
  dryRun?: boolean
  source: {
    urlv1: string
    urlv2: string
    token: string
  }
  destination: {
    urlv1: string
    urlv2: string
    token: string
  }
}) => {
  const sourceSdk = new KoboClient(source)
  const destinationSdk = new KoboClient(destination)

  const getFormsToMigrate = async (): Promise<Kobo.Form[]> => {
    const spinner = createSpinner('Fetching forms...').start()
    const {formIds, formIdsIgnored} = filters
    const forms = await sourceSdk.v2.form
      .getAll({limit: 10000})
      .then(_ => _.results)
      .then(f => {
        if (formIds) return f.filter(_ => formIds.includes(_.uid))
        if (formIdsIgnored) return f.filter(_ => !formIdsIgnored.includes(_.uid))
        return f
      })
    if (filters.formIds) return forms.filter(_ => filters.formIds!.includes(_.uid))
    spinner.success({text: `Fetching forms... ${forms.length} forms fetched`})
    return forms
  }

  /**
   * Encountered multiple scenarios where attachments were skipped due to their names.
   * This function standardizes attachment names to prevent such issues.
   */
  const standardizeAttachmentNames = (submission: Kobo.Submission): void => {
    submission._attachments?.forEach((attachment, i) => {
      const fileName = seq(attachment.filename.split('/')).last()!
      const newFileName = `${submission._xform_id_string}_${submission._id}-${seq(attachment.question_xpath.split('/')).last()}-${i}`
      attachment.filename = attachment.filename.replaceAll(fileName, newFileName)
      Object.keys(submission.answers).forEach(k => {
        if (!submission.answers[k]) return
        if (typeof submission.answers[k] === 'object') {
          standardizeAttachmentNames(submission.answers[k])
        }
        if (
          typeof submission.answers[k] === 'string' &&
          sourceSdk.v1.submission.sanitizeFileName(submission.answers[k]) === fileName
        ) {
          submission.answers[k] = newFileName
        }
      })
    })
  }

  const submit = async (...params: Parameters<KoboClient['v1']['submission']['submitXml']>) => {
    if (dryRun) {
      await sleep(50)
      return ''
    }
    const res = await destinationSdk.v1.submission.submitXml(...params)
    return res.instanceID?.replace('uuid:', '')
  }

  const updateValidation = async (...params: Parameters<KoboClient['v2']['submission']['updateValidation']>) => {
    if (dryRun) {
      await sleep(200)
    }
    await destinationSdk.v2.submission.updateValidation(...params)
  }

  const migrateForm = async (form: Kobo.Form, index: number, total: number) => {
    const t0 = new Date().getTime()
    const getElapsedTime = () => duration(new Date().getTime() - t0).toString()
    const makeLog = ({msg, step, showDuration, completed, length}: {msg: string, step: number, showDuration?: boolean, completed?: number, length?: number}) => {
      const logHead = `${c.bold(makeProgress(index + 1, total))} ${c.grey(form.uid)} ${truncateString(form.name, 40).padEnd(40, ' ')}`
      return `${logHead} ${makeStepper(step, 3)} ${msg.padEnd(34)} ${(completed && length ? makeProgressAndPercent(completed, length) : '').padStart(16, ' ')}\t${c.dim(showDuration ? getElapsedTime() : '')}`
    }

    const spinner = createSpinner(makeLog({step: 0, msg: 'Fetching submissions'})).start()

    const destinationExist = await destinationSdk.v2.form.get({formId: form.uid}).then(_ => !!_.uid)
    if (!destinationExist) {
      spinner.success(makeLog({step: 0, msg: 'Form does not exist in dest server', showDuration: true}))
      return
    }
    const submissions = await sourceSdk.v2.submission
      .get({formId: form.uid, filters: {start: filters.submissionDateStart, end: filters.submissionDateEnd}})
      .then(_ => _.results)
      .then(_ => (migratedAnswerTag ? _.filter(_ => _.answers[migratedAnswerTag] === 'true') : _))
      .then(_ => (filters.take || filters.offset ? _.splice(filters.offset ?? 0, filters.take) : _))
      .then(seq)

    if (submissions.length === 0) {
      spinner.success(makeLog({step: 0, msg: 'No data', showDuration: true}))
      return
    }

    let completed = 0

    const idx_uuid_validation = await PromisePool.withConcurrency(20)
      .for(submissions)
      .process(async submission => {
        standardizeAttachmentNames(submission)
        const res = await submit({
          formId: form.uid,
          data: submission.answers,
          attachments: submission._attachments?.map(_ => {
            const fileName = seq(_.filename.split('/')).last()!
            return {
              url: _.download_url,
              name: fileName,
            }
          }),
        })
        spinner.update(makeLog({step: 1, msg: ' Migrating answers + attachment', completed, length: submissions.length}))
        completed++
        if (res) return {uuid: res, validation: submission._validation_status.uid}
      })
      .then(_ =>
        seq(_.results)
          .compact()
          .reduceObject<Record<Kobo.Submission.UUID, Kobo.Submission.Validation>>(item => [
            item.uuid,
            item.validation!,
          ]),
      )

    spinner.update(makeLog({step: 2, msg: `Fetching new ${c.bold.grey('_.id')}`}))

    const idx_id_validation = await destinationSdk.v2.submission.get({formId: form.uid, filters: {start: subDays(new Date(), 1)}}).then(_ => {
      return seq(_.results)
        .map(_ => {
          const validation = idx_uuid_validation[_._uuid]
          if (validation) return {_id: _._id, status: validation}
        })
        .filter(_ => _ !== undefined)
        .groupBy(_ => _.status)
    })

    completed = 0
    await PromisePool.withConcurrency(1)
      .for(Obj.entries(idx_id_validation))
      .process(async ([validationStatus, subs]) => {
        await updateValidation({
          formId: form.uid,
          submissionIds: subs.map(_ => _._id),
          status: validationStatus,
        })
        spinner.update(makeLog({msg: 'Migrating validation status', length: submissions.length, completed, step: 3}))
        completed += subs.length
      })
    spinner.success(makeLog({msg: 'Migrating validation status', length: submissions.length, completed, step: 4, showDuration: true}))
  }

  const forms = await getFormsToMigrate()
  await PromisePool.withConcurrency(1)
    .for(forms)
    .process((_, i) => migrateForm(_, i, forms.length))
  process.exit(0)
}
