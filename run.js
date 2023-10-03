const path = require('path');
const os = require('os');

const currentDir = path.resolve(process.cwd());
const osTmpDir = path.resolve(os.tmpdir());

if (currentDir.startsWith(osTmpDir)) {
  return;
}

const script = require(path.resolve(__dirname, 'scripts', process.argv[2]));

if (script instanceof Function) {
  script(path.resolve(currentDir, '../typescript/bin/tsc'));
}
