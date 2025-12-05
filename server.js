const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
const initDatabase = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS solar_panels (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        power DECIMAL(5,2),
        efficiency INTEGER,
        status VARCHAR(20),
        temp INTEGER,
        dirt_level INTEGER,
        dust_accumulation VARCHAR(20),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS daily_stats (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL UNIQUE,
        total_power DECIMAL(10,2),
        avg_efficiency DECIMAL(5,2),
        total_energy DECIMAL(10,2),
        clean_panels INTEGER,
        dirty_panels INTEGER,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('❌ Database initialization error:', error);
  }
};

initDatabase();

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: '🌞 Solar Power Monitoring API',
    status: 'active',
    version: '1.0.0',
    endpoints: {
      get_data: 'GET /api/solar-data',
      save_data: 'POST /api/solar-data',
      get_panel: 'GET /api/solar-data/:panelName',
      get_stats: 'GET /api/stats',
      delete_old: 'DELETE /api/solar-data/cleanup/:days'
    }
  });
});

// GET all solar panel data
app.get('/api/solar-data', async (req, res) => {
  try {
    const limit = req.query.limit || 100;
    const result = await pool.query(
      `SELECT DISTINCT ON (name) *
       FROM solar_panels
       ORDER BY name, timestamp DESC
       LIMIT $1`,
      [limit]
    );
    
    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('GET Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// POST new solar panel data
app.post('/api/solar-data', async (req, res) => {
  try {
    const { panels, totalPower, avgEfficiency } = req.body;
    
    if (!panels || !Array.isArray(panels)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid data format. Expected panels array.'
      });
    }

    const insertedPanels = [];
    
    for (const panel of panels) {
      const result = await pool.query(
        `INSERT INTO solar_panels (name, power, efficiency, status, temp, dirt_level, dust_accumulation)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          panel.name,
          panel.power,
          panel.efficiency,
          panel.status,
          panel.temp,
          panel.dirtLevel,
          panel.dustAccumulation
        ]
      );
      insertedPanels.push(result.rows[0]);
    }

    const today = new Date().toISOString().split('T')[0];
    const cleanCount = panels.filter(p => p.dirtLevel < 10).length;
    const dirtyCount = panels.filter(p => p.dirtLevel >= 30).length;
    
    await pool.query(
      `INSERT INTO daily_stats (date, total_power, avg_efficiency, clean_panels, dirty_panels)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (date) 
       DO UPDATE SET 
         total_power = $2,
         avg_efficiency = $3,
         clean_panels = $4,
         dirty_panels = $5,
         timestamp = CURRENT_TIMESTAMP`,
      [today, totalPower, avgEfficiency, cleanCount, dirtyCount]
    );
    
    res.json({
      success: true,
      message: `Successfully saved data for ${panels.length} panels`,
      data: insertedPanels,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('POST Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET specific panel history
app.get('/api/solar-data/:panelName', async (req, res) => {
  try {
    const { panelName } = req.params;
    const limit = req.query.limit || 10;
    
    const result = await pool.query(
      `SELECT * FROM solar_panels 
       WHERE name = $1 
       ORDER BY timestamp DESC 
       LIMIT $2`,
      [panelName, limit]
    );
    
    res.json({
      success: true,
      panelName,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('GET Panel Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// GET daily statistics
app.get('/api/stats', async (req, res) => {
  try {
    const days = req.query.days || 7;
    
    const result = await pool.query(
      `SELECT * FROM daily_stats 
       ORDER BY date DESC 
       LIMIT $1`,
      [days]
    );
    
    res.json({
      success: true,
      period: `Last ${days} days`,
      data: result.rows
    });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// DELETE old records
app.delete('/api/solar-data/cleanup/:days', async (req, res) => {
  try {
    const { days } = req.params;
    
    const result = await pool.query(
      `DELETE FROM solar_panels 
       WHERE timestamp < NOW() - INTERVAL '${days} days'
       RETURNING *`
    );
    
    res.json({
      success: true,
      message: `Deleted ${result.rowCount} records older than ${days} days`
    });
  } catch (error) {
    console.error('DELETE Error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Solar Backend API running on port ${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
});