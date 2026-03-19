const { Client } = require('pg');
const c = new Client('postgresql://postgres:postgres@localhost:5433/demo_target?schema=public');
async function run() {
    await c.connect();
    await c.query('INSERT INTO test_data (val) VALUES ($1)', ['Commit 2 Data']);
    await c.end();
    console.log('DATA ADDED');
}
run().catch(console.error);
