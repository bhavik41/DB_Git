const { Client } = require('pg');

/**
 * Extracts comprehensive schema metadata including tables, columns, types, and primary keys.
 */
async function getSchemaSnapshot(connectionString) {
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // 1. Get all tables
        const tablesRes = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_type = 'BASE TABLE';
        `);

        const schema = {
            tables: {}
        };

        for (const row of tablesRes.rows) {
            const tableName = row.table_name;

            // 2. Get Column metadata for each table
            const columnsRes = await client.query(`
                SELECT column_name, data_type, is_nullable, column_default 
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = $1;
            `, [tableName]);

            // 3. Get Primary Key constraints
            const pksRes = await client.query(`
                SELECT kcu.column_name
                FROM information_schema.table_constraints tco
                JOIN information_schema.key_column_usage kcu 
                  ON kcu.constraint_name = tco.constraint_name
                  AND kcu.constraint_schema = tco.constraint_schema
                WHERE tco.constraint_type = 'PRIMARY KEY'
                  AND kcu.table_name = $1
            `, [tableName]);

            const pks = pksRes.rows.map(r => r.column_name);

            // 4. Transform into structured metadata
            schema.tables[tableName] = {
                columns: columnsRes.rows.reduce((acc, col) => {
                    acc[col.column_name] = {
                        type: col.data_type,
                        nullable: col.is_nullable === 'YES',
                        default: col.column_default,
                        isPrimaryKey: pks.includes(col.column_name)
                    };
                    return acc;
                }, {})
            };
        }

        await client.end();
        return schema;

    } catch (error) {
        console.error("Error during schema introspection:", error);
        if (client) await client.end();
        throw error;
    }
}

module.exports = { getSchemaSnapshot };
