import { descargarDatosSierju } from './descargas-sierju';

async function main() {
    // Ejemplo: descargar datos del año 2023 para un despacho específico
    const periodo = 2024;
    const codigosDespacho = ['150013105001']; // Reemplaza con un código de despacho válido

    try {
        await descargarDatosSierju(periodo, codigosDespacho);
        console.log('Proceso completado exitosamente');
    } catch (error) {
        console.error('Error durante la ejecución:', error);
    }
}

main(); 