-- Migration script to add import_history table and order_status_detail column, and improve daily_snapshots tracking

CREATE TABLE import_history (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL,
    import_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(255)
);

ALTER TABLE order_status_detail
ADD COLUMN updated_tracking_info JSONB;

-- Further improvements to daily_snapshots tracking
UPDATE daily_snapshots
SET additional_tracking_info = 'improved tracking';
