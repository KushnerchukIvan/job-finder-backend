require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const SerpApi = require('google-search-results-nodejs');

const app = express();
app.use(cors({ origin: 'https://ai-job-search-umber.vercel.app' }));
app.use(express.json());

app.post('/api/find-jobs', async (req, res) => {
  const { skills } = req.body;

  if (!skills || skills.length === 0) {
    return res.status(400).json({ error: 'Навички не передані' });
  }

  try {
    const level = skills[0];
    const direction = skills[1];
    const stack = skills.slice(2, 5).join(' ');

    const query = `"${level}" "${direction}" ${stack} site:djinni.co OR site:jobs.dou.ua OR site:work.ua/jobs`;
    console.log('Пошуковий запит:', query);

    const search = new SerpApi.GoogleSearch(process.env.SERPAPI_KEY);

    const searchResults = await new Promise((resolve, reject) => {
      search.json({
        q: query,
        num: 10,
        hl: 'uk',
        gl: 'ua',
        tbs: 'qdr:m'
      }, (data) => {
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      });
    });

    const items = searchResults.organic_results ?? [];
    console.log('Знайдено результатів:', items.length);

    if (items.length === 0) {
      return res.json({ jobs: [] });
    }

    const searchSnippets = items.map((item, i) =>
      `${i + 1}. Заголовок: ${item.title}\nURL: ${item.link}\nОпис: ${item.snippet}`
    ).join('\n\n');

    // Gemini фільтрує тільки релевантні вакансії
    const prompt = `
  Користувач шукає вакансію з такими параметрами: ${skills.join(', ')}.
  
  Ось результати пошуку:
  ${searchSnippets}
  
  Твоє завдання — відфільтруй тільки явно нерелевантні результати:
  1. Прибери статті, форуми, новини, головні сторінки сайтів.
  2. Прибери вакансії де рівень ЯВНО не співпадає (наприклад якщо шукають Junior а у заголовку написано Senior або Lead).
  3. Все інше залишай — краще показати більше вакансій ніж менше.
  
  Відповідь дай ТІЛЬКИ у форматі JSON масиву, без зайвого тексту, без markdown:
  [
    {
      "title": "назва посади",
      "company": "назва компанії",
      "url": "посилання з результатів пошуку",
      "description": "короткий опис вимог 1-2 речення"
    }
  ]
  
  Якщо жодна вакансія не підходить — поверни порожній масив [].
`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      }
    );

    const geminiData = await geminiResponse.json();
    console.log('Gemini відповідь:', JSON.stringify(geminiData, null, 2));

    if (geminiData.error) {
      return res.status(500).json({ error: `Помилка Gemini: ${geminiData.error.message}` });
    }

    const rawText = geminiData.candidates[0].content.parts[0].text;
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const jobs = JSON.parse(cleaned);

    console.log('Готово, вакансій після фільтрації:', jobs.length);
    res.json({ jobs });

  } catch (err) {
    console.error('Помилка:', err);
    res.status(500).json({ error: 'Помилка сервера' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

