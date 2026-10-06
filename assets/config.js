// Configuración de la app de comandas.
// Pega aquí la URL /exec de la Aplicación web de Apps Script.
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxqolFEIelvtyJqrVvy6e9j6pk0yZNi7vC-hXxY1Hp2WJkl_lC_aBBPTp7JxZIEeZo/exec',

  // Cada cuántos segundos se actualiza la lista de pedidos.
  REFRESCO_SEGUNDOS: 15,

  // Encabezado del ticket impreso.
  TICKET_TITULO: 'GIRA USA MONKEYS',
  TICKET_SUBTITULO: 'TJSS - Generacion 2028',

  // Valores iniciales de la impresora (cada equipo puede cambiarlos
  // desde el botón "Impresora"; se recuerdan en ese navegador).
  IMPRESORA: {
    modo: 'navegador',   // navegador | usb | serial | bluetooth
    papel: 58,           // 58 u 80 (mm)
    baudios: 9600,       // solo modo serial
    codepage: 2          // ESC t n → 2 = PC850 (tildes y ñ)
  }
};
