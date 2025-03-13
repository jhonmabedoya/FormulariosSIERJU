import 'dotenv/config';

if (!process.env.SIERJU_PASSWORD || !process.env.SIERJU_URL || !process.env.SIERJU_USERNAME) {
	throw new Error('Faltan variables de entorno requeridas');
}

const { PLAYWRIGHT_ENDPOINT, SIERJU_PASSWORD, SIERJU_URL, SIERJU_USERNAME } = process.env;

import _ from 'lodash';
import playwright, { type Page } from 'playwright';

interface DatosFila {
	despacho: string;
	codigoDespacho: string;
	funcionario: string;
	reportado: string;
	periodoReportado: string;
	idFormulario: string;
	codigoFormulario: string;
	nombre: string;
	estado: string;
	enlace: string;
}

// Configuración de backoff exponencial para reintentos.
const BASE = 1.5;
const MULTIPLICADOR = 3;
const MAX_REINTENTOS = 3;

async function iniciarSesion(page: Page) {
	await page.goto(SIERJU_URL);

	await page.fill("[name='j_username']", SIERJU_USERNAME);
	await page.fill("[name='j_password']", SIERJU_PASSWORD);
	await page.click("[type='submit']");
	await wait(5000);
}

async function irAPaginaDescarga(page: Page) {
	const linkVisible = await page.getByText('Reporte Actividad Diligenciamiento').isVisible();
	if (!linkVisible) {
		await page.getByText('Gestión Reportes').click();
		await page.waitForResponse((resp) => resp.status() === 200);
		await wait(1000);
	}
	await page.getByText('Reporte Actividad Diligenciamiento').click();
	await wait(1000);
}

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function descargarDatosDespachoSierju(page: playwright.Page, periodo: number, codigoDespacho: string) {
	await iniciarSesion(page);
	await irAPaginaDescarga(page);

	// Consultar reportes del despacho en el periodo especificado
	await page.fill("[name='formReporteFuncionario:inputFunDespacho']", codigoDespacho);
	await page.fill("[name='formReporteFuncionario:fechaInicio_input']", `01/01/${periodo}`);
	await page.fill("[name='formReporteFuncionario:fechaFin_input']", `31/12/${periodo}`);

	// Hacer clic doble para esperar que el botón "submit" esté habilitado.
	await page.click("[type='submit']");
	await page.click("[type='submit']");
	await page.waitForResponse((resp) => resp.request().method() === 'GET' && resp.status() === 200);
	await wait(1000);

	const textoSinResultados = await page.getByText('No hay Resultados para mostrar').isVisible();
	if (textoSinResultados) {
		console.error(`Codigo de despacho no encontrado: ${codigoDespacho}`);
		return true;
	}

	// Captura de pantalla del listado de reportes del despacho en el periodo
	await page.screenshot({ path: `./static/${codigoDespacho}/imgs/listado.png` });

	const columnas = [
		'despacho',
		'codigoDespacho',
		'funcionario',
		'reportado',
		'periodoReportado',
		'idFormulario',
		'codigoFormulario',
		'nombre',
		'estado',
	];

	const datosFilas: DatosFila[] = [];

	const filas = await page.$$("[id='formReporteFuncionario:tablerReporteInformes_data'] tr");

	for await (const fila of filas) {
		const celdas = await fila.$$('td');
		const textoCeldas = await Promise.all(celdas.map((c) => c.innerText()));
		const datosFila = _.zipObject(columnas, textoCeldas) as Partial<DatosFila>;
		datosFila.enlace = (await (await celdas[7].$('a'))?.getAttribute('id')) || '';

		datosFilas.push(datosFila as DatosFila);
	}

	// Filtrar datos para seleccionar solo los periodos finalizados a descargar
	const datosFilasParaExportar = _(datosFilas)
		.filter((fila: DatosFila) => fila.estado.includes('Finalizado'))
		.sortBy('reportado')
		.reverse()
		.groupBy('periodoReportado')
		.flatMap((i) => i[0])
		.sortBy('periodoReportado')
		.value();

	console.table(datosFilasParaExportar);

	// Ir a la página de detalle de cada uno de los reportes y descargar el archivo xls
	for await (const fila of datosFilasParaExportar) {
		await page.click(`[id='${fila.enlace}']`);
		await page.waitForResponse((resp) => resp.status() === 200);
		await page.waitForResponse((resp) => resp.request().method() === 'POST' && resp.status() === 200);

		const enlaceDescarga = await page.$("[id='formFormulariosRecuperar:j_idt102']");

		if (enlaceDescarga) {
			// Descargar archivo xls
			const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), enlaceDescarga.click()]);

			await download.saveAs(`./static/${codigoDespacho}/${fila.periodoReportado}.xls`);
			console.log('Descargado:', `${fila.periodoReportado}.xls`);
		}

		// Guardar la captura de pantalla de la página de detalle del reporte descargado.
		await page.screenshot({
			path: `./static/${codigoDespacho}/imgs/${fila.periodoReportado}.png`,
		});

		await page.getByText('Reporte Actividad Diligenciamiento').click();
		await page.waitForResponse((resp) => resp.status() === 200);
	}

	console.log(`Descarga de ${codigoDespacho} completa.\n`);
	return true;
}

async function playwrightBrowser(endpoint: string = '') {
	let browser: playwright.Browser = await (endpoint
		? playwright.chromium.connect(endpoint, { slowMo: 50 })
		: playwright.chromium.launch({ headless: true, slowMo: 50 }));
	let context: playwright.BrowserContext = await browser.newContext({ viewport: { width: 1920, height: 1200 } });
	let page: playwright.Page = await context.newPage();

	return {
		getPage: () => page,
		shutdown: async () => {
			await context.clearCookies();
			await context.close();
			await browser.close();
		},
	};
}

export async function descargarDatosSierju(periodo: number, codigosDespacho: string[] = []) {
	const browser = await playwrightBrowser(PLAYWRIGHT_ENDPOINT);
	const page = browser.getPage();

	for await (const codigoDespacho of codigosDespacho) {
		let resultado = false;
		let intentos = 0;

		do {
			try {
				if (intentos === 0) {
					console.log(`Descargando ${codigoDespacho} ...`);
				} else {
					console.log(`Reintento ${intentos} ...`);
				}
				resultado = await descargarDatosDespachoSierju(page, periodo, codigoDespacho);
			} catch (error) {
				console.log(error);
				// Ignorar errores y reintentar ...
			}

			if (!resultado) {
				intentos++;
				const tiempoReintento = Math.round(BASE * MULTIPLICADOR ** intentos);
				console.error(`Error en la descarga del despacho ${codigoDespacho}. Reintento ${intentos} en ${tiempoReintento} segundos`);
				await wait(tiempoReintento * 1000);
			}
		} while (!resultado && intentos <= MAX_REINTENTOS);
	}

	await browser.shutdown();
}
