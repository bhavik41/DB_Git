const { Client } = require('pg');
const c = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5433/dbgit?schema=public' });
async function check() {
    try {
        await c.connect();
        const res = await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log('Tables:', res.rows.map(r => r.table_name).join(', '));
    } catch(e) {
        console.error(e.message);
    } finally {
        await c.end();
    }
}
check();
