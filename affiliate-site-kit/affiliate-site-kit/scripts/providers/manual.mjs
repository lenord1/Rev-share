// 預設資料來源：不自動取得任何價格（價格由你維護 CSV）。回傳空陣列＝今天沒有新觀測。
export const name = 'manual';
export async function fetchObservations() { return []; }
