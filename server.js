const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');
const Anthropic  = require('@anthropic-ai/sdk');

const app       = express();
const port      = process.env.PORT || 3000;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Trust Railway's proxy ────────────────────────────────────────────
app.set('trust proxy', 1);

// ── Body parser ──────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));

// ── CORS ─────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Rate limiting ────────────────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes.' }
}));

// ── Health check ─────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Smart Job Feed API', version: '1.0.0' });
});

// ── POST /api/score-job ───────────────────────────────────────────────
// Scores a single job against resume text.
// Body: { resumeText, title, company, snippet }
app.post('/api/score-job', async (req, res) => {
  const { resumeText, title, company, snippet } = req.body;

  if (!resumeText || resumeText.length < 50) {
    return res.status(400).json({ error: 'Missing or too-short resumeText.' });
  }
  if (!title) {
    return res.status(400).json({ error: 'Missing job title.' });
  }

  const prompt = `You are a career advisor scoring a job listing against a candidate's resume.
Return ONLY a JSON object — no markdown, no extra text.
{ "score": <0-100>, "tier": <"apply"|"consider"|"skip">, "reason": <one sentence max 10 words> }
Scoring: 75-100=apply, 50-74=consider, 0-49=skip.

RESUME:
${resumeText.slice(0, 3000)}

JOB:
Title: ${title}
Company: ${company || ''}
Description: ${(snippet || '').slice(0, 500)}`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw    = message.content.map(c => c.text || '').join('');
    const result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json(result);

  } catch (err) {
    console.error('[score-job]', err.message);
    res.status(500).json({ error: 'Scoring failed. Please try again.' });
  }
});

// ── POST /api/analyze-job ─────────────────────────────────────────────
// Full deep analysis for the detail panel.
// Body: { resumeText, title, company, location, salary, description }
app.post('/api/analyze-job', async (req, res) => {
  const { resumeText, title, company, location, salary, description } = req.body;

  if (!resumeText || resumeText.length < 50) {
    return res.status(400).json({ error: 'Missing or too-short resumeText.' });
  }
  if (!description || description.length < 80) {
    return res.status(400).json({ error: 'Job description too short or missing.' });
  }

  const prompt = `You are an expert career coach analyzing job fit.
Return ONLY a JSON object — no markdown, no extra text.

RESUME:
${resumeText.slice(0, 3000)}

JOB TITLE: ${title || ''}
COMPANY: ${company || ''}
LOCATION: ${location || ''}${salary ? '\nSALARY: ' + salary : ''}

JOB DESCRIPTION:
${description.slice(0, 3000)}

Return exactly:
{
  "score": <integer 0-100>,
  "tier": <"apply"|"consider"|"skip">,
  "verdict": <one sentence max 12 words>,
  "breakdown": {"skills":<0-100>,"experience":<0-100>,"education":<0-100>,"culture_fit":<0-100>},
  "matched_skills": [<up to 8 strings>],
  "skill_gaps": [<up to 5 strings>],
  "summary": <2-3 sentence paragraph>
}
Scoring: 75-100=apply, 50-74=consider, 0-49=skip.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw      = message.content.map(c => c.text || '').join('');
    const analysis = JSON.parse(raw.replace(/```json|```/g, '').trim());
    res.json({ analysis });

  } catch (err) {
    console.error('[analyze-job]', err.message);
    res.status(500).json({ error: 'Analysis failed. Please try again.' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`✓ Smart Job Feed API running on port ${port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠ WARNING: ANTHROPIC_API_KEY is not set!');
  }
});
