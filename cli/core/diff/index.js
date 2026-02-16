function diffSchemas(oldSchema, newSchema) {
    const changes = [];

    const oldTables = Object.keys(oldSchema.tables);
    const newTables = Object.keys(newSchema.tables);

    // 1. Tables Added
    newTables.filter(t => !oldTables.includes(t)).forEach(tableName => {
        changes.push({
            type: 'ADD_TABLE',
            tableName: tableName,
            columns: newSchema.tables[tableName].columns
        });
    });

    // 2. Tables Removed
    oldTables.filter(t => !newTables.includes(t)).forEach(tableName => {
        changes.push({
            type: 'DROP_TABLE',
            tableName: tableName
        });
    });

    // 3. Compare Common Tables
    oldTables.filter(t => newTables.includes(t)).forEach(tableName => {
        const oldCols = oldSchema.tables[tableName].columns;
        const newCols = newSchema.tables[tableName].columns;

        const oldColNames = Object.keys(oldCols);
        const newColNames = Object.keys(newCols);

        // Columns Added
        newColNames.filter(c => !oldColNames.includes(c)).forEach(colName => {
            changes.push({
                type: 'ADD_COLUMN',
                tableName: tableName,
                columnName: colName,
                details: newCols[colName]
            });
        });

        // Columns Removed
        oldColNames.filter(c => !newColNames.includes(c)).forEach(colName => {
            changes.push({
                type: 'DROP_COLUMN',
                tableName: tableName,
                columnName: colName
            });
        });

        // Columns Modified (Comprehensive Check)
        oldColNames.filter(c => newColNames.includes(c)).forEach(colName => {
            const oldC = oldCols[colName];
            const newC = newCols[colName];
            const modifications = [];

            if (oldC.type !== newC.type) modifications.push({ trait: 'type', old: oldC.type, new: newC.type });
            if (oldC.nullable !== newC.nullable) modifications.push({ trait: 'nullable', old: oldC.nullable, new: newC.nullable });
            if (oldC.pk !== newC.pk) modifications.push({ trait: 'primary_key', old: oldC.pk, new: newC.pk });
            if (oldC.default !== newC.default) modifications.push({ trait: 'default', old: oldC.default, new: newC.default });

            if (modifications.length > 0) {
                changes.push({
                    type: 'ALTER_COLUMN',
                    tableName: tableName,
                    columnName: colName,
                    modifications: modifications
                });
            }
        });
    });

    return changes;
}

module.exports = { diffSchemas };
