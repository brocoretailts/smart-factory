CREATE DATABASE IF NOT EXISTS smart_factory;
USE smart_factory;

-- Tabel Master Barang
CREATE TABLE IF NOT EXISTS barang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kode_barang VARCHAR(50) UNIQUE NOT NULL,
    nama VARCHAR(100) NOT NULL,
    jenis ENUM('Mortar', 'Bata Ringan') NOT NULL,
    satuan VARCHAR(20) NOT NULL,
    lead_time INT DEFAULT 1,
    kapasitas_harian INT DEFAULT 0,
    kapasitas_gudang INT DEFAULT 0
);

-- Tabel Stock Harian (Log)
CREATE TABLE IF NOT EXISTS stock_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    barang_id INT,
    tipe ENUM('IN', 'OUT') NOT NULL,
    qty INT NOT NULL,
    tanggal DATE NOT NULL,
    keterangan VARCHAR(255),
    FOREIGN KEY (barang_id) REFERENCES barang(id)
);

-- Tabel Order Masuk
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    barang_id INT,
    qty INT NOT NULL,
    tanggal_order DATE NOT NULL,
    tanggal_kirim DATE NOT NULL,
    status ENUM('Pending', 'Selesai', 'Batal') DEFAULT 'Pending',
    FOREIGN KEY (barang_id) REFERENCES barang(id)
);

-- Tabel Produksi
CREATE TABLE IF NOT EXISTS produksi (
    id INT AUTO_INCREMENT PRIMARY KEY,
    barang_id INT,
    qty INT NOT NULL,
    tanggal DATE NOT NULL,
    FOREIGN KEY (barang_id) REFERENCES barang(id)
);

-- Tabel User
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role ENUM('Admin', 'Gudang', 'Produksi', 'Manajemen') DEFAULT 'Admin'
);

-- Insert sample data
INSERT INTO barang (kode_barang, nama, jenis, satuan, lead_time, kapasitas_harian, kapasitas_gudang) VALUES
('MTR-A', 'Mortar Tipe A', 'Mortar', 'sak', 2, 500, 2000),
('MTR-B', 'Mortar Tipe B', 'Mortar', 'sak', 2, 500, 2000),
('BTR-75', 'Bata Ringan 7.5', 'Bata Ringan', 'm3', 3, 100, 0);

INSERT INTO users (username, password, role) VALUES
('admin', 'admin123', 'Admin');
