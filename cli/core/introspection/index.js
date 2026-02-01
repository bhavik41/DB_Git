const { Client } = require('pg');

/**
 * Extracts the base table list from the public schema.
 */
async function getSchemaSnapshot(connectionString) {
    const client = new Client({ connectionString });

    try {
        await client.connect();

        // Query to get all tables in the public schema
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
            schema.tables[tableName] = { columns: {} };
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
