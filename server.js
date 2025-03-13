const express = require("express");
const cors = require("cors");
const { descargarDatosSierju } = require("./descargas-sierju.ts");


const app = express();
app.use(cors());
app.use(express.json());

app.post("/descargar", async (req, res) => {
  const { periodo, codigosDespacho } = req.body;
  
  if (!periodo || !codigosDespacho.length) {
    return res.status(400).json({ mensaje: "Datos incompletos" });
  }

  try {
    await descargarDatosSierju(periodo, codigosDespacho);
    res.json({ mensaje: `Descarga completada para el despacho:` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: "Error en la descarga" });
  }
});

app.listen(5000, () => console.log("Servidor corriendo en http://localhost:5000"));
