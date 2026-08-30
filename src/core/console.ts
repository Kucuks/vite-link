export function clearConsole(enabled: boolean): void {
  if (!enabled || !process.stdout.isTTY) return
  process.stdout.write('\u001B[2J\u001B[3J\u001B[H')
}
