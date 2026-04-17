const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const xlsx = require('xlsx');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'factory_secret_key';
const DB_PATH = path.join(__dirname, 'factory.db');

const upload = multer({ storage: multer.memoryStorage() });

// Database Connection
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('Database connection failed:', err.message);
    } else {
        console.log('Connected to SQLite Database');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // 1. Master Barang (Produk Jadi)
        db.run(`CREATE TABLE IF NOT EXISTS barang (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kode_barang TEXT UNIQUE NOT NULL,
            nama TEXT NOT NULL,
            jenis TEXT NOT NULL, -- Mortar / Bata Ringan
            satuan TEXT NOT NULL,
            lead_time INTEGER DEFAULT 1,
            min_buffer_days INTEGER DEFAULT 3
        )`);

        // Migration: Add missing columns if table already exists
        db.all("PRAGMA table_info(barang)", (err, rows) => {
            if (rows) {
                const columns = rows.map(r => r.name);
                if (!columns.includes('min_buffer_days')) {
                    db.run("ALTER TABLE barang ADD COLUMN min_buffer_days INTEGER DEFAULT 3");
                }
            }
        });

        // 2. Stock Log (Gabungan Produksi dan Keluar)
        db.run(`CREATE TABLE IF NOT EXISTS stock_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barang_id INTEGER,
            tipe TEXT NOT NULL, -- IN (Produksi), OUT (Keluar/Jual)
            qty INTEGER NOT NULL,
            tanggal TEXT NOT NULL, -- YYYY-MM-DD
            keterangan TEXT,
            FOREIGN KEY (barang_id) REFERENCES barang(id)
        )`);

        // 2b. Snapshot Laporan Harian (Stok Pagi + Aktivitas Kemarin)
        db.run(`CREATE TABLE IF NOT EXISTS daily_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barang_id INTEGER NOT NULL,
            tanggal_report TEXT NOT NULL, -- Hari berjalan (input pagi)
            tanggal_sumber TEXT NOT NULL, -- Hari kemarin yang direkap
            stok_pagi INTEGER DEFAULT 0,
            pengeluaran_kemarin INTEGER DEFAULT 0,
            kiriman_kemarin INTEGER DEFAULT 0,
            penjualan_kemarin INTEGER DEFAULT 0,
            order_kemarin INTEGER DEFAULT 0,
            produksi_kemarin INTEGER DEFAULT 0,
            catatan TEXT,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (barang_id) REFERENCES barang(id),
            UNIQUE (barang_id, tanggal_report)
        )`);

        // 2c. Tindak lanjut anomali stok harian
        db.run(`CREATE TABLE IF NOT EXISTS anomaly_followups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barang_id INTEGER NOT NULL,
            tanggal_report TEXT NOT NULL,
            status TEXT DEFAULT 'open', -- open / investigating / resolved
            pic TEXT,
            catatan TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (barang_id) REFERENCES barang(id),
            UNIQUE (barang_id, tanggal_report)
        )`);

        // 2d. Checklist tugas harian admin
        db.run(`CREATE TABLE IF NOT EXISTS daily_admin_tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tanggal TEXT NOT NULL,
            task_key TEXT NOT NULL,
            title TEXT NOT NULL,
            is_done INTEGER DEFAULT 0,
            note TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (tanggal, task_key)
        )`);

        // 3. Order Masuk (Backlog)
        db.run(`CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            barang_id INTEGER,
            qty INTEGER NOT NULL,
            tanggal_order TEXT NOT NULL,
            tanggal_kirim TEXT NOT NULL,
            status TEXT DEFAULT 'Pending',
            FOREIGN KEY (barang_id) REFERENCES barang(id)
        )`);

        // 4. Users
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'Admin'
        )`, () => {
            db.get("SELECT * FROM users WHERE username = 'admin'", (err, row) => {
                if (!row) {
                    db.run("INSERT INTO users (username, password, role) VALUES ('admin', 'admin123', 'Admin')");
                    db.run("INSERT INTO users (username, password, role) VALUES ('kepala_pabrik', 'pabrik123', 'Manajemen')");
                }
            });
        });

        // 5. Global Settings (Kapasitas Mesin & Gudang)
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`, () => {
            db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('kapasitas_global', '2000')");
            db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('kapasitas_gudang_global', '10000')");
            db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('kapasitas_per_jam_global', '250')");
        });
    });
}

const dbAll = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));
const dbGet = (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const dbRun = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function(err) { err ? rej(err) : res(this) }));

const toIsoDate = (value) => {
    if (!value) return null;
    if (typeof value === 'number') {
        const date = new Date((value - 25569) * 86400 * 1000);
        return date.toISOString().split('T')[0];
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString().split('T')[0];
};

const toInt = (value) => {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
};

const shiftDate = (dateStr, deltaDays) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + deltaDays);
    return date.toISOString().split('T')[0];
};

const getAnomalySeverity = (selisih) => {
    const abs = Math.abs(selisih);
    if (abs >= 200) return 'TINGGI';
    if (abs >= 75) return 'SEDANG';
    return 'RENDAH';
};

const normalizeKey = (key) => String(key || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const getFromRow = (row, aliases = []) => {
    const normalized = {};
    Object.keys(row || {}).forEach((k) => {
        normalized[normalizeKey(k)] = row[k];
    });
    for (const alias of aliases) {
        const value = normalized[normalizeKey(alias)];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
};

// --- API ROUTES ---

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = await dbGet('SELECT * FROM users WHERE username = ?', [username]);
        if (!user || password !== user.password) {
            return res.status(400).json({ success: false, message: 'Username atau Password salah' });
        }
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/dashboard', async (req, res) => {
    try {
        const barang = await dbAll('SELECT * FROM barang');
        const sMesin = await dbGet("SELECT value FROM settings WHERE key = 'kapasitas_global'");
        const sGudang = await dbGet("SELECT value FROM settings WHERE key = 'kapasitas_gudang_global'");
        const sJam = await dbGet("SELECT value FROM settings WHERE key = 'kapasitas_per_jam_global'");
        
        const kapasitasGlobal = parseInt(sMesin.value);
        const kapasitasGudangGlobal = parseInt(sGudang.value);
        const kapasitasPerJamGlobal = parseInt(sJam.value || 250);
        
        const dashboardData = [];
        let totalStokMortar = 0;

        for (let item of barang) {
            // Total Stok Sekarang
            const stockResult = await dbGet(`
                SELECT IFNULL(SUM(CASE WHEN tipe = 'IN' THEN qty ELSE -qty END), 0) as current_stock
                FROM stock_log WHERE barang_id = ?`, [item.id]);
            const current_stock = stockResult.current_stock;
            
            if (item.jenis === 'Mortar') {
                totalStokMortar += current_stock;
            }

            // Rata-rata Pemakaian (Order) 7 hari terakhir
            const usageResult = await dbGet(`
                SELECT IFNULL(AVG(qty), 0) as avg_usage
                FROM orders WHERE barang_id = ? AND tanggal_order >= date('now', '-7 days')`, [item.id]);
            const avgUsage = Number(usageResult.avg_usage || 1);
            const bufferDays = current_stock / avgUsage;

            // Backlog Order (Pending)
            const backlogResult = await dbGet(`SELECT IFNULL(SUM(qty), 0) as backlog FROM orders WHERE barang_id = ? AND status = 'Pending'`, [item.id]);
            const backlog = Number(backlogResult.backlog || 0);

            // Status
            let status = 'AMAN', color = 'emerald';
            if (bufferDays < item.min_buffer_days) { status = 'BAHAYA'; color = 'rose'; }
            else if (bufferDays < item.min_buffer_days + 2) { status = 'WASPADA'; color = 'amber'; }

            // Rekomendasi Produksi
            // Target buffer adalah min_buffer + 2 hari
            let targetBuffer = Number(item.min_buffer_days || 0) + 2;
            let recProduksi = Math.max(0, Math.round((targetBuffer * avgUsage) + backlog - Number(current_stock || 0)));
            let estimasiHari = Number(recProduksi / kapasitasGlobal).toFixed(1);
            
            // Estimasi Jam Kerja yang dibutuhkan (Pakai Global)
            let estimasiJam = Number(recProduksi / kapasitasPerJamGlobal).toFixed(1);

            dashboardData.push({
                ...item,
                stock: current_stock,
                usage: avgUsage.toFixed(1),
                buffer: bufferDays.toFixed(1),
                backlog: backlog,
                status,
                color,
                recommendation: recProduksi,
                estimasi_hari: estimasiHari,
                estimasi_jam: estimasiJam
            });
        }

        res.json({ 
            success: true, 
            data: dashboardData, 
            kapasitas_global: kapasitasGlobal,
            kapasitas_gudang_global: kapasitasGudangGlobal,
            kapasitas_per_jam_global: kapasitasPerJamGlobal,
            total_stok_mortar: totalStokMortar
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Import Laporan Harian (Excel Template)
app.post('/api/import/daily', upload.single('file'), async (req, res) => {
    const { tanggal: defaultTanggal } = req.body;
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'File wajib diunggah.' });
        }

        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);

        await dbRun('BEGIN TRANSACTION');
        for (let row of data) {
            const kodeBarang = getFromRow(row, ['KODE', 'KODE_BARANG', 'SKU', 'PRODUCT_CODE']);
            const barang = await dbGet('SELECT id FROM barang WHERE kode_barang = ?', [kodeBarang]);
            if (barang) {
                const reportDate = toIsoDate(getFromRow(row, ['TANGGAL_REPORT', 'TANGGAL', 'REPORT_DATE']) || defaultTanggal) || defaultTanggal;
                const sourceDate = toIsoDate(getFromRow(row, ['TANGGAL_SUMBER', 'TANGGAL_KEMARIN', 'SOURCE_DATE'])) || shiftDate(reportDate, -1);
                const stokPagi = toInt(getFromRow(row, ['STOK_PAGI', 'STOK_AWAL', 'STOK', 'OPENING_STOCK']));
                const pengeluaranKemarin = toInt(getFromRow(row, ['PENGELUARAN_KEMARIN', 'KELUAR_KEMARIN', 'PENGELUARAN', 'OUTBOUND_YESTERDAY']));
                const kirimanKemarin = toInt(getFromRow(row, ['KIRIMAN_KEMARIN', 'KELUAR', 'KIRIMAN', 'DELIVERY_YESTERDAY']));
                const penjualanKemarin = toInt(getFromRow(row, ['PENJUALAN_KEMARIN', 'PENJUALAN', 'SALES_YESTERDAY']));
                const orderKemarin = toInt(getFromRow(row, ['ORDER_KEMARIN', 'ORDER', 'ORDER_MASUK', 'ORDER_YESTERDAY']));
                const produksiKemarin = toInt(getFromRow(row, ['PRODUKSI_KEMARIN', 'PRODUKSI', 'PRODUCTION_YESTERDAY']));
                const totalKeluarKemarin = pengeluaranKemarin + kirimanKemarin + penjualanKemarin;

                // Sinkronisasi stok pagi sebagai titik awal laporan hari berjalan.
                const stockBefore = await dbGet(`
                    SELECT IFNULL(SUM(CASE WHEN tipe='IN' THEN qty ELSE -qty END), 0) as qty
                    FROM stock_log
                    WHERE barang_id = ? AND tanggal < ?
                `, [barang.id, reportDate]);
                const diffStokPagi = stokPagi - (stockBefore?.qty || 0);
                if (diffStokPagi !== 0) {
                    await dbRun(
                        'INSERT INTO stock_log (barang_id, tipe, qty, tanggal, keterangan) VALUES (?, ?, ?, ?, ?)',
                        [barang.id, diffStokPagi > 0 ? 'IN' : 'OUT', Math.abs(diffStokPagi), reportDate, `Sinkronisasi Stok Pagi Import (${sourceDate})`]
                    );
                }

                if (produksiKemarin > 0) {
                    await dbRun(
                        'INSERT INTO stock_log (barang_id, tipe, qty, tanggal, keterangan) VALUES (?, ?, ?, ?, ?)',
                        [barang.id, 'IN', produksiKemarin, sourceDate, `Import Produksi Kemarin (${reportDate})`]
                    );
                }
                if (pengeluaranKemarin > 0) {
                    await dbRun(
                        'INSERT INTO stock_log (barang_id, tipe, qty, tanggal, keterangan) VALUES (?, ?, ?, ?, ?)',
                        [barang.id, 'OUT', pengeluaranKemarin, sourceDate, `Import Pengeluaran Kemarin (${reportDate})`]
                    );
                }
                if (kirimanKemarin > 0) {
                    await dbRun(
                        'INSERT INTO stock_log (barang_id, tipe, qty, tanggal, keterangan) VALUES (?, ?, ?, ?, ?)',
                        [barang.id, 'OUT', kirimanKemarin, sourceDate, `Import Kiriman Kemarin (${reportDate})`]
                    );
                }
                if (penjualanKemarin > 0) {
                    await dbRun(
                        'INSERT INTO stock_log (barang_id, tipe, qty, tanggal, keterangan) VALUES (?, ?, ?, ?, ?)',
                        [barang.id, 'OUT', penjualanKemarin, sourceDate, `Import Penjualan Kemarin (${reportDate})`]
                    );
                }

                // Order fulfillment hanya dari kiriman (barang benar-benar dikirim)
                if (kirimanKemarin > 0) {
                    let remainingKeluar = kirimanKemarin;
                    const pendingOrders = await dbAll('SELECT id, qty FROM orders WHERE barang_id = ? AND status = "Pending" ORDER BY tanggal_order ASC', [barang.id]);
                    for (let order of pendingOrders) {
                        if (remainingKeluar <= 0) break;
                        if (order.qty <= remainingKeluar) {
                            await dbRun('UPDATE orders SET status = "Completed" WHERE id = ?', [order.id]);
                            remainingKeluar -= order.qty;
                        } else {
                            await dbRun('UPDATE orders SET qty = qty - ? WHERE id = ?', [remainingKeluar, order.id]);
                            remainingKeluar = 0;
                        }
                    }
                }

                if (orderKemarin > 0) {
                    await dbRun(
                        'INSERT INTO orders (barang_id, qty, tanggal_order, tanggal_kirim, status) VALUES (?, ?, ?, ?, ?)',
                        [barang.id, orderKemarin, sourceDate, toIsoDate(getFromRow(row, ['EST_KIRIM', 'TANGGAL_KIRIM', 'ESTIMATE_DELIVERY'])) || reportDate, 'Pending']
                    );
                }

                await dbRun(`
                    INSERT INTO daily_snapshots (
                        barang_id, tanggal_report, tanggal_sumber, stok_pagi, pengeluaran_kemarin, kiriman_kemarin,
                        penjualan_kemarin, order_kemarin, produksi_kemarin, catatan
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(barang_id, tanggal_report) DO UPDATE SET
                        tanggal_sumber = excluded.tanggal_sumber,
                        stok_pagi = excluded.stok_pagi,
                        pengeluaran_kemarin = excluded.pengeluaran_kemarin,
                        kiriman_kemarin = excluded.kiriman_kemarin,
                        penjualan_kemarin = excluded.penjualan_kemarin,
                        order_kemarin = excluded.order_kemarin,
                        produksi_kemarin = excluded.produksi_kemarin,
                        catatan = excluded.catatan,
                        imported_at = CURRENT_TIMESTAMP
                `, [
                    barang.id,
                    reportDate,
                    sourceDate,
                    stokPagi,
                    pengeluaranKemarin,
                    kirimanKemarin,
                    penjualanKemarin,
                    orderKemarin,
                    produksiKemarin,
                    getFromRow(row, ['CATATAN', 'NOTE', 'KETERANGAN']) || null
                ]);
            }
        }
        await dbRun('COMMIT');
        res.json({ success: true, message: 'Laporan harian lengkap berhasil diimpor' });
    } catch (err) {
        await dbRun('ROLLBACK');
        res.status(500).json({ success: false, message: err.message });
    }
});

// API untuk Chart Dashboard (Tren 7 Hari)
app.get('/api/dashboard/charts', async (req, res) => {
    try {
        const labels = [];
        const produksi = [];
        const keluar = [];
        const orders = [];

        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            const labelStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
            
            labels.push(labelStr);

            const prod = await dbGet("SELECT SUM(qty) as total FROM stock_log WHERE tipe='IN' AND tanggal=?", [dateStr]);
            const out = await dbGet("SELECT SUM(qty) as total FROM stock_log WHERE tipe='OUT' AND tanggal=?", [dateStr]);
            const ord = await dbGet("SELECT SUM(qty) as total FROM orders WHERE tanggal_order=?", [dateStr]);

            produksi.push(prod.total || 0);
            keluar.push(out.total || 0);
            orders.push(ord.total || 0);
        }

        res.json({ success: true, labels, produksi, keluar, orders });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Master Barang CRUD
app.get('/api/barang', async (req, res) => {
    const data = await dbAll('SELECT * FROM barang');
    res.json({ success: true, data });
});

app.post('/api/barang', async (req, res) => {
    const { id, kode_barang, nama, jenis, satuan, lead_time, min_buffer_days } = req.body;
    try {
        if (id) {
            await dbRun(`UPDATE barang SET kode_barang=?, nama=?, jenis=?, satuan=?, lead_time=?, min_buffer_days=? WHERE id=?`, 
                [kode_barang, nama, jenis, satuan, lead_time, min_buffer_days, id]);
        } else {
            await dbRun(`INSERT INTO barang (kode_barang, nama, jenis, satuan, lead_time, min_buffer_days) VALUES (?, ?, ?, ?, ?, ?)`, 
                [kode_barang, nama, jenis, satuan, lead_time, min_buffer_days]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/barang/:id', async (req, res) => {
    await dbRun('DELETE FROM barang WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

// Laporan Harian API
app.get('/api/reports/daily', async (req, res) => {
    const { tanggal, barang_id } = req.query;
    try {
        const prevDate = shiftDate(tanggal, -1);
        const data = await dbAll(`
            SELECT b.id, b.kode_barang, b.nama, b.satuan,
            COALESCE(ds.stok_pagi, (
                SELECT IFNULL(SUM(CASE WHEN tipe='IN' THEN qty ELSE -qty END), 0) FROM stock_log WHERE barang_id=b.id AND tanggal < ?
            )) as stok_pagi,
            COALESCE(ds.produksi_kemarin, (
                SELECT IFNULL(SUM(qty), 0) FROM stock_log WHERE barang_id=b.id AND tipe='IN' AND tanggal=?
            )) as produksi_kemarin,
            COALESCE(ds.pengeluaran_kemarin, 0) as pengeluaran_kemarin,
            COALESCE(ds.kiriman_kemarin, (
                SELECT IFNULL(SUM(qty), 0) FROM stock_log WHERE barang_id=b.id AND tipe='OUT' AND tanggal=?
            )) as kiriman_kemarin,
            COALESCE(ds.penjualan_kemarin, 0) as penjualan_kemarin,
            COALESCE(ds.order_kemarin, (
                SELECT IFNULL(SUM(qty), 0) FROM orders WHERE barang_id=b.id AND tanggal_order=?
            )) as order_kemarin,
            COALESCE(ds.tanggal_sumber, ?) as tanggal_sumber
            FROM barang b
            LEFT JOIN daily_snapshots ds ON ds.barang_id = b.id AND ds.tanggal_report = ?
        `, [tanggal, prevDate, prevDate, prevDate, prevDate, tanggal]);

        const formatted = [];
        const anomalies = [];
        for (let d of data) {
            const keluarKemarinTotal = d.pengeluaran_kemarin + d.kiriman_kemarin + d.penjualan_kemarin;
            // STOK_PAGI adalah stok final awal hari ini, tidak dikurangi lagi aktivitas kemarin.
            const stockBerjalan = d.stok_pagi;
            const stockKonsistensi = d.stok_pagi - d.produksi_kemarin + keluarKemarinTotal;
            const stockKemarinActual = await dbGet(`
                SELECT IFNULL(SUM(CASE WHEN tipe='IN' THEN qty ELSE -qty END), 0) as qty
                FROM stock_log
                WHERE barang_id = ? AND tanggal <= ?
            `, [d.id, prevDate]);
            const backlogAktif = await dbGet(`
                SELECT IFNULL(SUM(qty), 0) as qty
                FROM orders
                WHERE barang_id = ? AND status = 'Pending'
            `, [d.id]);
            
            // Hitung rata-rata pengeluaran 7 hari terakhir untuk estimasi barang habis
            const usageResult = await dbGet(`
                SELECT IFNULL(AVG(qty), 0) as avg_usage
                FROM stock_log WHERE barang_id = ? AND tipe = 'OUT' AND tanggal >= date(?, '-7 days') AND tanggal <= ?`, [d.id, tanggal, tanggal]);
            
            const avgUsage = usageResult.avg_usage || 1;
            const daysRemaining = Math.floor(stockBerjalan / avgUsage);
            
            let estHabis = 'N/A';
            if (daysRemaining >= 0 && daysRemaining < 365) {
                const habisDate = new Date(tanggal);
                habisDate.setDate(habisDate.getDate() + daysRemaining);
                estHabis = habisDate.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
            }

            formatted.push({
                ...d,
                stok_kemarin_sistem: stockKemarinActual?.qty || 0,
                expected_stok_pagi: (stockKemarinActual?.qty || 0) + d.produksi_kemarin - keluarKemarinTotal,
                anomali_stok: ((stockKemarinActual?.qty || 0) + d.produksi_kemarin - keluarKemarinTotal) !== d.stok_pagi,
                keluar_kemarin_total: keluarKemarinTotal,
                order_terkirim_kemarin: d.kiriman_kemarin,
                backlog_aktif: backlogAktif?.qty || 0,
                stock_konsistensi_check: stockKonsistensi,
                stok_berjalan_hari_ini: stockBerjalan,
                avg_usage: avgUsage.toFixed(1),
                estimasi_habis: estHabis,
                tanggal_transaksi: tanggal
            });

            const expectedStokPagi = (stockKemarinActual?.qty || 0) + d.produksi_kemarin - keluarKemarinTotal;
            if (expectedStokPagi !== d.stok_pagi) {
                const selisih = d.stok_pagi - expectedStokPagi;
                const severity = getAnomalySeverity(selisih);
                anomalies.push({
                    barang_id: d.id,
                    kode_barang: d.kode_barang,
                    nama: d.nama,
                    stok_pagi_input: d.stok_pagi,
                    stok_pagi_expected: expectedStokPagi,
                    selisih,
                    severity,
                    tanggal_report: tanggal,
                    tanggal_sumber: d.tanggal_sumber
                });
            }
        }
        const timelineParams = [tanggal, tanggal];
        let timelineFilterSql = '';
        if (barang_id) {
            timelineFilterSql = ' AND sl.barang_id = ?';
            timelineParams.push(barang_id);
        }
        const timeline = await dbAll(`
            SELECT sl.tanggal, b.nama, b.kode_barang, sl.tipe, sl.qty, sl.keterangan
            FROM stock_log sl
            JOIN barang b ON b.id = sl.barang_id
            WHERE sl.tanggal BETWEEN date(?, '-13 days') AND ? ${timelineFilterSql}
            ORDER BY sl.tanggal DESC, sl.id DESC
        `, timelineParams);

        const followups = await dbAll(`
            SELECT barang_id, tanggal_report, status, pic, catatan, updated_at
            FROM anomaly_followups
            WHERE tanggal_report = ?
        `, [tanggal]);
        const followupMap = new Map(followups.map(f => [`${f.barang_id}_${f.tanggal_report}`, f]));
        const anomaliesWithFollowup = anomalies.map(a => {
            const followup = followupMap.get(`${a.barang_id}_${a.tanggal_report}`);
            return {
                ...a,
                followup_status: followup?.status || 'open',
                followup_pic: followup?.pic || '',
                followup_catatan: followup?.catatan || '',
                followup_updated_at: followup?.updated_at || null
            };
        });

        const kpi = {
            total_produk: formatted.length,
            total_stok_pagi: formatted.reduce((acc, item) => acc + item.stok_pagi, 0),
            total_keluar_kemarin: formatted.reduce((acc, item) => acc + item.keluar_kemarin_total, 0),
            total_order_kemarin: formatted.reduce((acc, item) => acc + item.order_kemarin, 0),
            total_stok_berjalan: formatted.reduce((acc, item) => acc + item.stok_berjalan_hari_ini, 0),
            total_anomali: anomaliesWithFollowup.length,
            anomali_tinggi: anomaliesWithFollowup.filter(a => a.severity === 'TINGGI').length,
            anomali_sedang: anomaliesWithFollowup.filter(a => a.severity === 'SEDANG').length,
            anomali_rendah: anomaliesWithFollowup.filter(a => a.severity === 'RENDAH').length,
            followup_open: anomaliesWithFollowup.filter(a => a.followup_status === 'open').length,
            followup_investigating: anomaliesWithFollowup.filter(a => a.followup_status === 'investigating').length,
            followup_resolved: anomaliesWithFollowup.filter(a => a.followup_status === 'resolved').length
        };

        res.json({ success: true, data: formatted, timeline, kpi, anomalies: anomaliesWithFollowup });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/reports/management', async (req, res) => {
    const { tanggal } = req.query;
    try {
        const prevDate = shiftDate(tanggal, -1);
        const rows = await dbAll(`
            SELECT b.id, b.nama, b.kode_barang,
            COALESCE(ds.stok_pagi, 0) as stok_pagi,
            COALESCE(ds.produksi_kemarin, 0) as produksi_kemarin,
            COALESCE(ds.pengeluaran_kemarin, 0) as pengeluaran_kemarin,
            COALESCE(ds.kiriman_kemarin, 0) as kiriman_kemarin,
            COALESCE(ds.penjualan_kemarin, 0) as penjualan_kemarin,
            COALESCE(ds.order_kemarin, 0) as order_kemarin
            FROM barang b
            LEFT JOIN daily_snapshots ds ON ds.barang_id = b.id AND ds.tanggal_report = ?
        `, [tanggal]);

        const anomalies = await dbAll(`
            SELECT af.status, COUNT(*) as total
            FROM anomaly_followups af
            WHERE af.tanggal_report = ?
            GROUP BY af.status
        `, [tanggal]);
        const anomalyMap = Object.fromEntries(anomalies.map(a => [a.status, a.total]));

        const operational = rows.map((r) => {
            const totalKeluar = r.pengeluaran_kemarin + r.kiriman_kemarin + r.penjualan_kemarin;
            return {
                ...r,
                total_keluar_kemarin: totalKeluar,
                stok_berjalan: r.stok_pagi
            };
        });

        const topRisks = [...operational]
            .sort((a, b) => a.stok_berjalan - b.stok_berjalan)
            .slice(0, 5)
            .map((r) => ({
                kode_barang: r.kode_barang,
                nama: r.nama,
                stok_berjalan: r.stok_berjalan,
                order_kemarin: r.order_kemarin
            }));

        const totals = {
            total_stok_pagi: operational.reduce((acc, r) => acc + r.stok_pagi, 0),
            total_produksi_kemarin: operational.reduce((acc, r) => acc + r.produksi_kemarin, 0),
            total_keluar_kemarin: operational.reduce((acc, r) => acc + r.total_keluar_kemarin, 0),
            total_order_kemarin: operational.reduce((acc, r) => acc + r.order_kemarin, 0),
            total_stok_berjalan: operational.reduce((acc, r) => acc + r.stok_berjalan, 0),
            total_produk: operational.length
        };

        const narrative = [
            `Tanggal laporan ${tanggal} dengan sumber data operasional ${prevDate}.`,
            `Stok pagi total ${totals.total_stok_pagi.toLocaleString()} unit, dengan arus keluar kemarin ${totals.total_keluar_kemarin.toLocaleString()} unit.`,
            `Order kemarin ${totals.total_order_kemarin.toLocaleString()} unit, status follow-up anomali: open ${anomalyMap.open || 0}, investigating ${anomalyMap.investigating || 0}, resolved ${anomalyMap.resolved || 0}.`
        ];

        const recommendations = [
            'Prioritaskan item dengan stok berjalan terendah untuk produksi shift awal.',
            'Selesaikan seluruh anomali status open sebelum input pagi berikutnya.',
            'Pastikan admin mengunci checklist harian setelah import data tervalidasi.'
        ];

        res.json({
            success: true,
            tanggal,
            tanggal_sumber: prevDate,
            totals,
            top_risks: topRisks,
            anomaly_followup_status: {
                open: anomalyMap.open || 0,
                investigating: anomalyMap.investigating || 0,
                resolved: anomalyMap.resolved || 0
            },
            narrative,
            recommendations
        });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

const DEFAULT_ADMIN_TASKS = [
    { task_key: 'import_laporan', title: 'Import laporan stok pagi + aktivitas kemarin' },
    { task_key: 'validasi_anomali', title: 'Validasi anomali stok dan isi tindak lanjut' },
    { task_key: 'cek_order_backlog', title: 'Cek order/backlog dan prioritas kiriman' },
    { task_key: 'publish_report', title: 'Kirim report manajemen ke pimpinan' }
];

app.get('/api/admin-tasks', async (req, res) => {
    const { tanggal } = req.query;
    try {
        let tasks = await dbAll('SELECT * FROM daily_admin_tasks WHERE tanggal = ? ORDER BY id ASC', [tanggal]);
        if (tasks.length === 0) {
            for (const t of DEFAULT_ADMIN_TASKS) {
                await dbRun(
                    'INSERT INTO daily_admin_tasks (tanggal, task_key, title, is_done, note) VALUES (?, ?, ?, 0, NULL)',
                    [tanggal, t.task_key, t.title]
                );
            }
            tasks = await dbAll('SELECT * FROM daily_admin_tasks WHERE tanggal = ? ORDER BY id ASC', [tanggal]);
        }
        res.json({ success: true, data: tasks });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/admin-tasks', async (req, res) => {
    const { tanggal, task_key, title, is_done, note } = req.body;
    try {
        if (!tanggal || !task_key || !title) {
            return res.status(400).json({ success: false, message: 'Data tugas harian tidak lengkap.' });
        }
        await dbRun(`
            INSERT INTO daily_admin_tasks (tanggal, task_key, title, is_done, note, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(tanggal, task_key) DO UPDATE SET
                title = excluded.title,
                is_done = excluded.is_done,
                note = excluded.note,
                updated_at = CURRENT_TIMESTAMP
        `, [tanggal, task_key, title, is_done ? 1 : 0, note || null]);
        res.json({ success: true, message: 'Tugas harian tersimpan.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/reports/anomaly-followup', async (req, res) => {
    const { barang_id, tanggal_report, status, pic, catatan } = req.body;
    try {
        const allowedStatus = ['open', 'investigating', 'resolved'];
        if (!barang_id || !tanggal_report || !allowedStatus.includes(status)) {
            return res.status(400).json({ success: false, message: 'Data tindak lanjut tidak valid.' });
        }

        await dbRun(`
            INSERT INTO anomaly_followups (barang_id, tanggal_report, status, pic, catatan, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(barang_id, tanggal_report) DO UPDATE SET
                status = excluded.status,
                pic = excluded.pic,
                catatan = excluded.catatan,
                updated_at = CURRENT_TIMESTAMP
        `, [barang_id, tanggal_report, status, pic || null, catatan || null]);

        res.json({ success: true, message: 'Tindak lanjut anomali tersimpan.' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Stock Opname (Sinkronisasi Stok Fisik)
app.post('/api/barang/opname', async (req, res) => {
    const { barang_id, stok_fisik, tanggal } = req.body;
    try {
        // 1. Hitung stok sistem saat ini
        const stockResult = await dbGet(`
            SELECT IFNULL(SUM(CASE WHEN tipe = 'IN' THEN qty ELSE -qty END), 0) as current_stock
            FROM stock_log WHERE barang_id = ?`, [barang_id]);
        
        const selisih = stok_fisik - stockResult.current_stock;

        if (selisih !== 0) {
            const tipe = selisih > 0 ? 'IN' : 'OUT';
            const qty = Math.abs(selisih);
            await dbRun('INSERT INTO stock_log (barang_id, tipe, qty, tanggal, keterangan) VALUES (?, ?, ?, ?, ?)', 
                [barang_id, tipe, qty, tanggal, 'Stock Opname (Penyesuaian Fisik)']);
        }

        res.json({ success: true, message: 'Stok fisik berhasil disinkronisasi' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// API Settings
app.get('/api/settings', async (req, res) => {
    try {
        const rows = await dbAll('SELECT * FROM settings');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { key, value } = req.body;
    try {
        await dbRun('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// API Forecast & Simulasi 10 Hari
app.get('/api/forecast/:barang_id', async (req, res) => {
    const { barang_id } = req.params;
    try {
        const item = await dbGet('SELECT * FROM barang WHERE id = ?', [barang_id]);
        const setting = await dbGet("SELECT value FROM settings WHERE key = 'kapasitas_global'");
        const kapasitasGlobal = parseInt(setting.value);
        
        // 1. Stok Saat Ini
        const stockResult = await dbGet(`
            SELECT IFNULL(SUM(CASE WHEN tipe = 'IN' THEN qty ELSE -qty END), 0) as current_stock
            FROM stock_log WHERE barang_id = ?`, [barang_id]);
        let currentStock = stockResult.current_stock;

        // 2. Rata-rata Order (Trend)
        const usageResult = await dbGet(`
            SELECT IFNULL(AVG(qty), 0) as avg_usage
            FROM orders WHERE barang_id = ? AND tanggal_order >= date('now', '-7 days')`, [barang_id]);
        const dailyDemand = usageResult.avg_usage || 0;

        // 3. Backlog (Order tertunda)
        const backlogResult = await dbGet(`SELECT IFNULL(SUM(qty), 0) as backlog FROM orders WHERE barang_id = ? AND status = 'Pending'`, [barang_id]);
        let backlog = backlogResult.backlog;

        const forecast = [];
        let runningStock = currentStock;

        for (let i = 1; i <= 10; i++) {
            const date = new Date();
            date.setDate(date.getDate() + i);
            const dateStr = date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

            // Pengeluaran (Backlog dulu baru demand harian)
            let outToday = 0;
            if (backlog > 0) {
                outToday = Math.min(backlog, dailyDemand + 50); // Asumsi kirim backlog + reguler
                backlog -= outToday;
            } else {
                outToday = dailyDemand;
            }

            // Estimasi Produksi (Jika stok < 3 hari demand)
            let inToday = 0;
            if (runningStock < dailyDemand * 3) {
                inToday = kapasitasGlobal;
            }

            runningStock = runningStock + inToday - outToday;

            forecast.push({
                hari: dateStr,
                stok_awal: (runningStock - inToday + outToday).toFixed(0),
                masuk: inToday.toFixed(0),
                keluar: outToday.toFixed(0),
                stok_akhir: runningStock.toFixed(0)
            });
        }

        res.json({ success: true, data: forecast, item: item.nama });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
