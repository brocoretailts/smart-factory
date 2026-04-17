// generate_template.js

const XLSX = require('xlsx');

function generateDailyStockReportTemplate() {
    const workbook = XLSX.utils.book_new();
    const worksheetData = [
        ['Product ID', 'Product Name', 'Quantity', 'Stock Location', 'Reorder Level'],
        ['', '', '', '', ''], // Sample empty row for input
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set data validation for 'Quantity' column (C)
    const quantityValidation = {
        sheet: 'Sheet1',
        ref: 'C2:C100',
        type: 'decimal',
        operator: 'greaterThanOrEqual',
        formula1: 0
    };

    XLSX.utils.dataValidation(worksheet, quantityValidation);

    // Optionally, set some column widths
    worksheet['!cols'] = [
        { wch: 15 }, // Product ID
        { wch: 30 }, // Product Name
        { wch: 10 }, // Quantity
        { wch: 20 }, // Stock Location
        { wch: 15 }  // Reorder Level
    ];

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Stock Report Template');

    // Save workbook to file
    const fileName = 'Daily_Stock_Report_Template.xlsx';
    XLSX.writeFile(workbook, fileName);
    console.log(`Template created: ${fileName}`);
}

generateDailyStockReportTemplate();
