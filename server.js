const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const CLAUDE_MODEL = 'claude-sonnet-4-6';
const SYSTEM_PROMPT = `You are a media bias analyst. Given these news headlines and snippets about a topic, analyze how different outlets are framing the story. For each article identify: the outlet name, the angle they are pushing, what they emphasize, what they omit, and their apparent bias direction (left-leaning, right-leaning, neutral, alarmist, corporate-friendly etc). Then give an overall summary of the media landscape around this topic. Be sharp, specific and honest.`;

app.use(cors());
app.use(express.json());

app.post('/api/news', async (req, res) => {
  const { topic } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });

  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'NEWS_API_KEY not set' });

  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(topic)}&language=en&sortBy=publishedAt&pageSize=5&apiKey=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok || data.status === 'error') {
      return res.status(response.status).json({ error: data.message || 'NewsAPI error' });
    }

    res.json({ articles: data.articles || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/analyze', async (req, res) => {
  const { topic, articles } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic is required' });
  if (!Array.isArray(articles) || articles.length === 0) {
    return res.status(400).json({ error: 'articles array is required' });
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'CLAUDE_API_KEY not set' });

  const articleBlock = articles.map((a, i) =>
    `[${i + 1}] Source: ${a.source?.name || 'Unknown'}\nTitle: ${a.title || '(no title)'}\nDescription: ${a.description || '(no description)'}`
  ).join('\n\n');

  const userMsg = `Topic: "${topic}"\n\nArticles:\n${articleBlock}\n\nRespond with ONLY valid JSON — no markdown, no extra text — in this exact structure:\n{\n  "articles": [\n    {\n      "outlet": "outlet name",\n      "angle": "the specific narrative angle this outlet pushes",\n      "emphasizes": "what they highlight or amplify",\n      "omits": "what they leave out or downplay",\n      "bias": "one of: left | right | neutral | alarmist | corporate | sensationalist | nationalist | establishment | government-friendly",\n      "analysis": "2-3 sharp sentences of analysis"\n    }\n  ],\n  "overall_summary": "A paragraph summarizing the overall media landscape and dominant framing patterns"\n}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Claude API error' });
    }

    const raw = data.content?.[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();

    let analysis;
    try {
      analysis = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        analysis = JSON.parse(match[0]);
      } else {
        return res.status(500).json({ error: 'Failed to parse Claude response as JSON' });
      }
    }

    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Bias Detector API running on port ${PORT}`);
});
