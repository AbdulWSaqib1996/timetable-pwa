// Select only this dispatch at the expected main commit, never "latest run".
let input = ''
for await (const chunk of process.stdin) input += chunk
const [id, sha] = process.argv.slice(2)
const matches = JSON.parse(input).filter(run => run.displayTitle === id && run.headSha === sha)
if (matches.length > 1) throw new Error('Ambiguous deployment runs')
if (matches[0]) process.stdout.write(String(matches[0].databaseId))
