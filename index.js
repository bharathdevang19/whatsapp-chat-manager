const express = require('express');
const multer = require('multer');
const fs = require('fs');
const { Client } = require('pg');
const path = require('path');
const env = require('dotenv')

env.config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

client.connect();

app.get('/', (req, res) => {
  res.render('index', { results: undefined });
});

app.post('/upload', upload.single('chat'), async (req, res) => {
  const filePath = req.file.path;
  const data = fs.readFileSync(filePath, 'utf8');
  const lines = data.split('\n');

  const regex = /^(\d{1,2}\/\d{1,2}\/\d{2,4}), (\d{1,2}:\d{2})\s?(am|pm)? - ([^:]+): (.+)$/i;

  try {
    await client.query('DELETE FROM messages');

    for (const line of lines) {
      const match = line.match(regex);
      if (match) {
        let [_, date, time, meridiem, sender, message] = match;

        const [day, month, year] = date.split('/');
        const formattedDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

        let [hour, minute] = time.split(':');
        hour = parseInt(hour);
        if (meridiem?.toLowerCase() === 'pm' && hour < 12) hour += 12;
        if (meridiem?.toLowerCase() === 'am' && hour === 12) hour = 0;
        const formattedTime = `${hour.toString().padStart(2, '0')}:${minute}:00`;

        await client.query(
          'INSERT INTO messages (message_date, message_time, sender, message) VALUES ($1, $2, $3, $4)',
          [formattedDate, formattedTime, sender, message]
        );
      }
    }

    fs.unlinkSync(filePath);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(500).send('Something went wrong while uploading.');
  }
});

app.get('/search', async (req, res) => {
  const q = req.query.q.trim();

  try {
    let results;
    if (!q) {
      results = [];
    } else {
      const { rows } = await client.query(`
        SELECT * FROM messages
        WHERE
          CAST(id AS TEXT) ILIKE $1 OR
          message_date::TEXT ILIKE $1 OR
          sender ILIKE $1 OR
          message ILIKE $1
      `, [`%${q}%`]);
      results = rows;
    }

    res.render('index', { results });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error while searching.');
  }
});

app.get('/all', async (req, res) => {
  try {
    const { rows } = await client.query('SELECT * FROM messages ORDER BY id ASC');
    res.render('index', { results: rows });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error while fetching all messages.');
  }
});

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
