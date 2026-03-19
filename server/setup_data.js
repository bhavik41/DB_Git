const { Client } = require('pg');
const c = new Client('postgresql://postgres:postgres@localhost:5433/demo_target?schema=public');
async function run() {
    await c.connect();
    await c.query('DROP TABLE IF EXISTS test_data CASCADE');
    await c.query('CREATE TABLE test_data (id SERIAL PRIMARY KEY, val TEXT)');
    await c.query("INSERT INTO test_data (val) VALUES ('Commit 1 Data')");
    await c.end();
    console.log('SETUP DONE');
}
run().catch(console.error);
