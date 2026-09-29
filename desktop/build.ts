export {}
for (const args of [
  [
    'cmake',
    '-S',
    'desktop/qt',
    '-B',
    'dist/desktop/build',
    '-G',
    'Ninja',
    '-DCMAKE_BUILD_TYPE=RelWithDebInfo',
    `-DDERP_DESKTOP_TESTS=${process.argv.includes('--tests') ? 'ON' : 'OFF'}`,
    '-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=' + process.cwd() + '/dist/desktop',
  ],
  ['cmake', '--build', 'dist/desktop/build', '--parallel', '4'],
]) {
  const child = Bun.spawn(args, { stdout: 'inherit', stderr: 'inherit' })
  if (await child.exited) throw new Error('Qt desktop build failed')
}
