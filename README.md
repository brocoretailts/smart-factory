# Smart Factory Management System

Sistem manajemen stok pabrik pintar berbasis web untuk monitoring stok real-time, forecasting ketahanan stok, dan rekomendasi produksi otomatis.

## Fitur Utama
- **Dashboard Manajemen**: Visualisasi stok, buffer hari, dan status (Aman/Waspada/Bahaya).
- **Forecasting**: Prediksi berapa hari stok akan habis berdasarkan rata-rata pemakaian 7 hari terakhir.
- **Rekomendasi Produksi**: AI-style narrative yang memberikan saran jumlah produksi untuk mencapai stok aman.
- **Input Transaksi**: Modul input untuk hasil produksi dan order masuk (penjualan).
- **Login System**: Keamanan akses untuk manajemen dan staf.
- **KPI Charts**: Grafik perbandingan stok dan ketahanan produk.

## Persyaratan Sistem
- Node.js v14 atau lebih baru
- MySQL Server

## Cara Instalasi Lokal

1. **Persiapkan Database**:
   - Buka MySQL (phpMyAdmin atau MySQL Workbench).
   - Jalankan script SQL yang ada di file `db.sql` untuk membuat database dan tabel yang diperlukan.

2. **Instal Dependensi**:
   Buka terminal di folder project dan jalankan:
   ```bash
   npm install
   ```

3. **Konfigurasi Environment**:
   - Edit file `.env` dan sesuaikan dengan konfigurasi MySQL Anda (DB_HOST, DB_USER, DB_PASSWORD).

4. **Jalankan Program**:
   ```bash
   npm start
   ```
   Buka browser dan akses `http://localhost:3000`.

## Cara Deployment Online (Railway/Render)

Sistem ini sudah siap dideploy ke platform cloud seperti Railway atau Render.

1. **Push ke GitHub**:
   Upload semua file ini ke repository GitHub Anda.

2. **Deploy ke Railway**:
   - Hubungkan akun GitHub ke [Railway.app](https://railway.app).
   - Buat project baru dan pilih repository tersebut.
   - Tambahkan Plugin **MySQL** di Railway.
   - Railway akan otomatis memberikan variabel environment (MYSQLHOST, MYSQLUSER, dll).
   - Sesuaikan file `server.js` atau set variables di Dashboard Railway agar sesuai dengan variabel yang diberikan Railway.

3. **Akses dari HP**:
   Setelah deploy berhasil, Railway akan memberikan URL publik (contoh: `https://smart-factory-production.up.railway.app`). Buka URL tersebut di browser HP manajemen.

## Akun Login Default
- **Username**: admin
- **Password**: admin123
