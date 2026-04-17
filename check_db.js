const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const DB_PATH = path.join(__dirname, 'factory.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        return;
    }
    console.log('Checking users in database...');
    db.all("SELECT id, username, password, role FROM users", [], (err, rows) => {
        if (err) {
            console.error('Error querying users:', err.message);
        } else {
            console.log('Users found:');
            rows.forEach((row) => {
                console.log(`- ID: ${row.id}, Username: ${row.username}, Password: ${row.password}, Role: ${row.role}`);
            });
            if (rows.length === 0) {
                console.log('No users found in database.');
            }
        }
        db.close();
    });
});
