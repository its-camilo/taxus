# taxus

Generador de **borradores** de declaración de renta (formularios DIAN **110** y **210**) a partir de información exógena, con RAG del [Estatuto Tributario](https://estatuto.co/) en Pinecone y modelos gratis de OpenRouter.

No sustituye Muisca ni un contador.

## Uso local

```bash
cp .env.example .env.local
npm install
npm test
npm run dev
```

Suba el XLSX de “detalle de lo reportado por terceros” y, si quiere, CSV/PDF/XLSX complementarios. Revise las casillas y descargue el PDF (página 1 de la plantilla oficial).

Las plantillas en `public/templates` salen de los PDF de la DIAN
`Formularios/2025/Formulario_210_2025.pdf` y `Formulario_110_2025.pdf`
(idénticos a los archivos 2026 de este repositorio).
