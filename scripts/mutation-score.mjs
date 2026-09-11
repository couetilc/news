import { readFileSync } from 'node:fs';

// A low score is useful data; a missing, unfinished or malformed run is not.
// Stryker's own nonzero exit fails the preceding workflow step independently.
try {
  const report = JSON.parse(readFileSync(process.argv[2] ?? 'reports/mutation/mutation.json', 'utf8'));
  if (!report.files || typeof report.files !== 'object' || Array.isArray(report.files)) {
    throw new Error('report.files must be an object');
  }
  const counts = { Killed: 0, Timeout: 0, Survived: 0, NoCoverage: 0, CompileError: 0, RuntimeError: 0, Ignored: 0 };
  for (const [path, file] of Object.entries(report.files)) {
    if (!file || !Array.isArray(file.mutants)) throw new Error(`${path}: missing mutants array`);
    for (const mutant of file.mutants) {
      if (!mutant || !Object.hasOwn(counts, mutant.status)) {
        throw new Error(`${path}: unknown or unfinished mutant status`);
      }
      counts[mutant.status]++;
    }
  }
  const valid = counts.Killed + counts.Timeout + counts.Survived + counts.NoCoverage;
  if (valid === 0) throw new Error('report contains no measured mutants');
  process.stdout.write((100 * (counts.Killed + counts.Timeout) / valid).toFixed(2));
} catch (error) {
  console.error(`Invalid mutation report: ${error.message}`);
  process.exitCode = 1;
}
