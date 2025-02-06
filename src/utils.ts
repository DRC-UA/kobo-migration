import c from 'ansi-colors'

export const truncateString = (str: string, maxLength: number) => {
  return str.length > maxLength ? str.slice(0, maxLength - 3) + '...' : str
}

export const makeProgress = (current: number, max: number) => {
  return `${current.toString().padStart(max.toString().length, ' ')}/${max}`
}

export const makeProgressAndPercent = (current: number, max: number) => {
  return `${makeProgress(current, max)} ${((current / max) * 100).toFixed(1).toString().padStart(4, ' ')}%`
}

export const makeStepper = (current: number, max: number): string => {
  if (current < 0 || current > max + 1) {
    throw new Error('Invalid step: "current" must be between 1 and max + 1.')
  }
  const completed = c.green('(✓)')

  let stepper = ''

  for (let i = 0; i <= max; i++) {
    if (i < current) {
      stepper += completed
    } else if (i === current) {
      stepper += c.blue.bold(`(${i + 1})`)
    } else {
      stepper += `(${i + 1})`
    }

    if (i < max) {
      stepper += '-'
    }
  }

  return stepper
}
