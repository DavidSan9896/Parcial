const express = require('express');
const neo4j = require('neo4j-driver');
const { Client } = require('pg');
const fs = require('fs');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
require('dotenv').config();

// Configuración de Neo4j
const neo4jDriver = neo4j.driver(
    process.env.NEO4J_URI,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
);

// Configuración de PostgreSQL
const pgClient = new Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DB,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});

// Inicializar Express
const app = express();
const PORT = process.env.PORT || 3000;

// Función para convertir nombres a camelCase
function toCamelCase(str) {
    return str
        .toLowerCase()
        .split(' ')
        .map((word, index) =>
            index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
        )
        .join('');
}

// Función para clasificar la popularidad
function classifyPopularity(value) {
    if (value < 30) return "Poco Usado";
    if (value >= 30 && value <= 70) return "Moderado";
    return "Muy Popular";
}

// Función para clasificar la velocidad
function classifySpeed(value) {
    if (value < 40) return "Lento";
    if (value >= 40 && value <= 70) return "Rápido";
    return "Muy Rápido";
}

// Función para extraer datos de Neo4j
async function extractData() {
    const session = neo4jDriver.session();
    try {
        const result = await session.run('MATCH (n) RETURN n LIMIT 10');
        return result.records.map(record => record.get('n').properties);
    } catch (error) {
        console.error('Error extracting data:', error);
        return [];
    } finally {
        await session.close();
    }
}

// Función para transformar los datos
async function transformData(data) {
    return data.map(item => {
        const popularidad = item.popularidad || 0;
        const velocidad = item.velocidad || 0;
        const eficiencia = (popularidad + velocidad) / 2;

        return {
            id: item.id || null,
            name: toCamelCase(item.name || 'Unknown'),
            popularity: classifyPopularity(popularidad),
            speed: classifySpeed(velocidad),
            efficiency: eficiencia.toFixed(2) // Redondeado a 2 decimales
        };
    });
}

// Función para cargar datos en PostgreSQL
async function loadData(data) {
    await pgClient.connect();
    for (const item of data) {
        await pgClient.query(
            'INSERT INTO etl_data (id, name, popularity, speed, efficiency) VALUES ($1, $2, $3, $4, $5)',
            [item.id, item.name, item.popularity, item.speed, item.efficiency]
        );
    }
    await pgClient.end();
}

// Función para exportar a CSV
async function exportToCSV(data) {
    const csvWriter = createCsvWriter({
        path: './output/recap.csv',
        header: [
            { id: 'id', title: 'ID' },
            { id: 'name', title: 'Name' },
            { id: 'popularity', title: 'Popularity' },
            { id: 'speed', title: 'Speed' },
            { id: 'efficiency', title: 'Efficiency' }
        ]
    });
    await csvWriter.writeRecords(data);
    console.log('CSV Exported!');
}

// Endpoint REST para extraer datos de Neo4j
app.get('/api/extract', async (req, res) => {
    try {
        const extracted = await extractData();
        const transformed = await transformData(extracted);
        res.json({ success: true, data: transformed });
    } catch (error) {
        console.error('Error in /api/extract:', error);
        res.status(500).json({ success: false, message: 'Error extracting data' });
    }
});

// Iniciar servidor
app.listen(PORT, async () => {
    console.log(`Server running on http://localhost:${PORT}`);

    // Ejecutar el proceso ETL al iniciar el servidor
    try {
        console.log('Running ETL process...');
        const extracted = await extractData();
        const transformed = await transformData(extracted);
        await loadData(transformed);
        await exportToCSV(transformed);
        console.log('ETL process completed.');
    } catch (error) {
        console.error('Error running ETL process:', error);
    }
});
