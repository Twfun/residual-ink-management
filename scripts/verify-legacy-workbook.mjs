import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import ExcelJS from 'exceljs';

const { Workbook } = ExcelJS;

const workbookPath = resolve(process.argv[2] || 'C:/Users/qwq12/Desktop/紫金旧墨管理库.xlsm');
await access(workbookPath);

const workbook = new Workbook();
await workbook.xlsx.readFile(workbookPath);
const inventorySheet = workbook.getWorksheet('库存表');
const outboundSheet = workbook.getWorksheet('出库表');
if (!inventorySheet || !outboundSheet) throw new Error('Workbook must contain 库存表 and 出库表.');

const inventoryHeaders = headerMap(inventorySheet, 2);
const outboundHeaders = headerMap(outboundSheet, 1);
const inventoryRows = businessRows(inventorySheet, 3, inventoryHeaders.get('库位'));
const outboundRows = businessRows(outboundSheet, 2, outboundHeaders.get('出库单号'));

const inventory = {
  rows: inventoryRows.length,
  blankWeight: countBlank(inventorySheet, inventoryRows, inventoryHeaders.get('重量')),
  blankRollerColor: countBlank(inventorySheet, inventoryRows, inventoryHeaders.get('版辊号+色序')),
  blankInboundDate: countBlank(inventorySheet, inventoryRows, inventoryHeaders.get('入库日期')),
  matchable: inventoryRows.filter((row) =>
    ['L', 'a', 'b'].every((key) => !isBlank(inventorySheet.getRow(row).getCell(required(inventoryHeaders, key)).value)),
  ).length,
};
const outbound = {
  rows: outboundRows.length,
  blankWeight: countBlank(outboundSheet, outboundRows, outboundHeaders.get('重量')),
  blankRollerColor: countBlank(outboundSheet, outboundRows, outboundHeaders.get('版辊号+色序')),
};

assertEqual('inventory rows', inventory.rows, 3409);
assertEqual('inventory blank roller/color', inventory.blankRollerColor, 970);
assertEqual('inventory blank inbound date', inventory.blankInboundDate, 54);
assertEqual('inventory matchable Lab', inventory.matchable, 3356);
assertEqual('outbound rows', outbound.rows, 1370);
assertEqual('outbound blank weight', outbound.blankWeight, 1369);
assertEqual('outbound blank roller/color', outbound.blankRollerColor, 216);

console.log(
  JSON.stringify(
    { workbookPath, sheets: workbook.worksheets.map((sheet) => sheet.name), inventory, outbound },
    null,
    2,
  ),
);

function headerMap(sheet, rowNumber) {
  const result = new Map();
  sheet.getRow(rowNumber).eachCell((cell, column) => result.set(cell.text.trim(), column));
  return result;
}

function businessRows(sheet, start, keyColumn) {
  const key = requiredColumn(keyColumn, 'business key');
  const rows = [];
  for (let row = start; row <= sheet.rowCount; row++) {
    if (!isBlank(sheet.getRow(row).getCell(key).value)) rows.push(row);
  }
  return rows;
}

function countBlank(sheet, rows, column) {
  const index = requiredColumn(column, 'column');
  return rows.filter((row) => isBlank(sheet.getRow(row).getCell(index).value)).length;
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'object' && 'result' in value) return isBlank(value.result);
  if (typeof value === 'object' && 'richText' in value) return value.richText.every((part) => isBlank(part.text));
  return String(value).trim() === '';
}

function required(map, key) {
  return requiredColumn(map.get(key), key);
}

function requiredColumn(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}`);
}
