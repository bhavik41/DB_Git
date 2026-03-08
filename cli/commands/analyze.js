const chalk = require('chalk');
const { table } = require('table');
const configManager = require('../utils/config');
const apiService = require('../services/api');

/**
 * Member 5 — dbv analyze
 *
 * Reports on:
 *   1. Storage Analysis: Snapshot vs Migration-Replay vs Hybrid storage trade-offs
 *   2. Index / Query Plan Analysis: Validates that indexes are being used on hot-path queries
 *   3. M5 Enhancements Summary: Compression, In-Memory Cache, GIN Index status
 */
module.exports = async function analyze(options) {
    configManager.ensureExists();
    const config = configManager.getConfig();
    await apiService.init();

    const projectName = config.projectName;

    // ─── STORAGE ANALYSIS ─────────────────────────────────────────────────────
    if (!options.indexOnly) {
        console.log(chalk.cyan('\n══════════════════════════════════════════════════════════'));
        console.log(chalk.cyan.bold('  M5 — Storage Strategy Analysis'));
        console.log(chalk.cyan('══════════════════════════════════════════════════════════'));

        try {
            const res = await apiService.client.get(`/projects/${projectName}/analyze/storage`);
            const s = res.data.stats;

            console.log(chalk.white(`\n  Project     : ${chalk.bold(s.projectName)}`));
            console.log(chalk.white(`  Commits     : ${chalk.bold(s.totalCommits)}`));
            console.log(chalk.white(`  With Diff   : ${chalk.green(s.commitsWithDiff)}`));
            console.log(chalk.white(`  Snapshots Only : ${chalk.yellow(s.commitsWithoutDiff)}`));

            console.log(chalk.cyan('\n  ┌─ Storage Strategy Comparison ─────────────────────────┐'));

            const storageData = [
                [chalk.bold('Strategy'), chalk.bold('Size (KB)'), chalk.bold('Description')],
                [
                    chalk.yellow('Snapshot-per-Commit'),
                    chalk.yellow(s.storageBreakdown.snapshotOnlyKB + ' KB'),
                    'Full schema JSON stored with every commit'
                ],
                [
                    chalk.blue('Migration Replay (Diff-only)'),
                    chalk.blue(s.storageBreakdown.migrationReplayKB + ' KB'),
                    'Only diffs stored; reconstruct by replaying from origin'
                ],
                [
                    chalk.green('Hybrid (Baseline + Diffs)'),
                    chalk.green(s.storageBreakdown.hybridKB + ' KB'),
                    '1 baseline snapshot + incremental diffs'
                ]
            ];

            console.log(table(storageData, {
                border: {
                    topBody: '─', topJoin: '┬', topLeft: '  ├', topRight: '┤',
                    bottomBody: '─', bottomJoin: '┴', bottomLeft: '  ├', bottomRight: '┤',
                    bodyLeft: '  │', bodyRight: '│', bodyJoin: '│',
                    joinBody: '─', joinLeft: '  ├', joinRight: '┤', joinJoin: '┼'
                }
            }));

            // Recommendation banner
            const rec = s.recommendation;
            if (rec.startsWith('SWITCH_TO_HYBRID')) {
                console.log(chalk.red.bold('  ⚠  RECOMMENDATION: ' + rec.split(': ')[1]));
            } else {
                console.log(chalk.green.bold('  ✓  RECOMMENDATION: ' + rec.split(': ')[1]));
            }

            // Per-commit breakdown
            if (options.verbose && s.perCommitAnalysis?.length > 0) {
                console.log(chalk.cyan('\n  ┌─ Per-Commit Storage Breakdown ────────────────────────┐'));
                const commitData = [
                    [
                        chalk.bold('Commit ID'),
                        chalk.bold('Message'),
                        chalk.bold('Snapshot (B)'),
                        chalk.bold('Diff (B)'),
                        chalk.bold('Has Diff')
                    ],
                    ...s.perCommitAnalysis.map(c => [
                        c.commitId,
                        c.message.substring(0, 30) + (c.message.length > 30 ? '…' : ''),
                        c.snapshotSizeBytes.toString(),
                        c.diffSizeBytes.toString(),
                        c.hasDiff ? chalk.green('✓') : chalk.dim('—')
                    ])
                ];
                console.log(table(commitData));
            }

        } catch (err) {
            console.log(chalk.red('  ✖ Storage analysis failed: ' + (err.response?.data?.error || err.message)));
        }
    }

    // ─── INDEX / QUERY PLAN ANALYSIS ──────────────────────────────────────────
    if (!options.storageOnly) {
        console.log(chalk.cyan('\n══════════════════════════════════════════════════════════'));
        console.log(chalk.cyan.bold('  M5 — Index & Query Performance Analysis'));
        console.log(chalk.cyan('══════════════════════════════════════════════════════════\n'));

        try {
            const res = await apiService.client.get(`/projects/${projectName}/analyze/indexes`);
            const analysis = res.data.analysis;

            const indexData = [
                [
                    chalk.bold('Query'),
                    chalk.bold('Node Type'),
                    chalk.bold('Index Used'),
                    chalk.bold('Est. Cost'),
                    chalk.bold('Status')
                ],
                ...analysis.map(q => {
                    if (q.error) {
                        return [q.name, chalk.red('ERROR'), '—', '—', chalk.red(q.error.substring(0, 40))];
                    }
                    const usingIndex = q.indexUsed || (q.planType && q.planType.toLowerCase().includes('index'));
                    return [
                        q.name.replace(/_/g, ' '),
                        q.planType || '?',
                        usingIndex ? chalk.green(q.indexUsed || 'Yes') : chalk.red('None (Seq Scan!)'),
                        q.estimatedCost != null ? q.estimatedCost.toFixed(2) : '?',
                        usingIndex ? chalk.green('✓ Indexed') : chalk.red('⚠ No Index')
                    ];
                })
            ];

            console.log(table(indexData));

            // Summary
            const indexed = analysis.filter(q => !q.error && (q.indexUsed || (q.planType && q.planType.toLowerCase().includes('index')))).length;
            const total = analysis.filter(q => !q.error).length;
            console.log(chalk.white(`  Index coverage: ${indexed}/${total} hot-path queries use an index.`));
            if (indexed < total) {
                console.log(chalk.yellow(`  ⚠  ${total - indexed} query/queries performing Sequential Scans — check index definitions.`));
            } else {
                console.log(chalk.green(`  ✓  All monitored queries are index-backed.`));
            }

        } catch (err) {
            console.log(chalk.red('  ✖ Index analysis failed: ' + (err.response?.data?.error || err.message)));
            console.log(chalk.dim('    (This requires a live database connection with tables already created)'));
        }
    }

    // ─── SYSTEM / CACHE ANALYSIS ──────────────────────────────────────────────
    // Always shown unless the user has narrowed the scope with --storage-only or --index-only
    if (!options.storageOnly && !options.indexOnly) {
        console.log(chalk.cyan('\n══════════════════════════════════════════════════════════'));
        console.log(chalk.cyan.bold('  M5 — PostgreSQL System Cache & Actual Index Usage'));
        console.log(chalk.cyan('══════════════════════════════════════════════════════════\n'));

        try {
            const res = await apiService.client.get(`/projects/${projectName}/analyze/system`);
            const sys = res.data.systemStats;

            console.log(chalk.white(`  Overall Cache Hit Ratio: ${chalk.bold(sys.cacheHitRatio)}`));
            
            if (sys.cacheAnalysis.includes('Excellent')) {
                console.log(chalk.green(`  ✓  ${sys.cacheAnalysis}`));
            } else {
                console.log(chalk.yellow(`  ⚠  ${sys.cacheAnalysis}`));
            }

            console.log(chalk.cyan('\n  ┌─ M5 Index Usage Statistics (Since DB Boot) ───────────┐'));

            const sysIndexData = [
                [
                    chalk.bold('Table'),
                    chalk.bold('Index Name'),
                    chalk.bold('Usage Count (Scans)'),
                    chalk.bold('Tuples Read via Index')
                ],
                ...sys.indexUsage.map(i => [
                    i.table,
                    i.index,
                    i.scans === 0 ? chalk.red(i.scans) : chalk.green(i.scans),
                    i.tuplesRead
                ])
            ];

            if (sys.indexUsage.length === 0) {
                console.log(chalk.dim('     (No custom indexes detected or recorded yet)'));
            } else {
                console.log(table(sysIndexData));
            }

        } catch (err) {
            console.log(chalk.red('  ✖ System analysis failed: ' + (err.response?.data?.error || err.message)));
        }
    }

    // ─── INDEX EFFICIENCY ANALYSIS ──────────────────────────────────────────
    if (!options.storageOnly && !options.indexOnly) {
        console.log(chalk.cyan('\n══════════════════════════════════════════════════════════'));
        console.log(chalk.cyan.bold('  M5 — Index Efficiency Ratio (Table vs Index Size)'));
        console.log(chalk.cyan('══════════════════════════════════════════════════════════\n'));

        try {
            const res = await apiService.client.get(`/projects/${projectName}/analyze/efficiency`);
            const efficiency = res.data.efficiency;

            const efficiencyData = [
                [
                    chalk.bold('Table'),
                    chalk.bold('Total Size'),
                    chalk.bold('Table/Index'),
                    chalk.bold('Index %'),
                    chalk.bold('Verdict')
                ],
                ...efficiency.map(e => [
                    e.table,
                    e.totalSize,
                    `${e.tableSize} / ${e.indexSize}`,
                    e.indexRatioPct + '%',
                    e.indexRatioPct > 70 ? chalk.red(e.verdict) : e.indexRatioPct > 40 ? chalk.yellow(e.verdict) : chalk.green(e.verdict)
                ])
            ];

            console.log(table(efficiencyData));
            console.log(chalk.dim('  (A lower ratio is better. High ratios > 50% suggest redundant indexes.)'));

        } catch (err) {
            console.log(chalk.red('  ✖ Efficiency analysis failed: ' + (err.response?.data?.error || err.message)));
        }
    }

    console.log('');
};
