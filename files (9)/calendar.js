const { createSign } = require('crypto');

const CLIENT_EMAIL  = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY   = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const CALENDAR_ID   = process.env.GOOGLE_CALENDAR_ID; // your Google account email

const TIME_SLOTS = [
  '9:00 AM','10:00 AM','11:00 AM',
  '12:00 PM','1:00 PM','2:00 PM',
  '3:00 PM','4:00 PM','5:00 PM'
];

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss:   CLIENT_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud:   'https://oauth2.googleapis.com/token',
    exp:   now + 3600,
    iat:   now,
  };

  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claim)).toString('base64url');
  const input   = `${header}.${payload}`;

  const sign = createSign('RSA-SHA256');
  sign.update(input);
  const sig = sign.sign(PRIVATE_KEY, 'base64url');

  const jwt = `${input}.${sig}`;

  const res  = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token: ' + JSON.stringify(data));
  return data.access_token;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { date } = event.queryStringParameters || {};
  if (!date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'date param required (YYYY-MM-DD)' }) };
  }

  try {
    const accessToken = await getAccessToken();

    // Use Eastern Time boundaries for the day
    const timeMin = new Date(`${date}T00:00:00`);
    const timeMax = new Date(`${date}T23:59:59`);

    const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: 'America/New_York',
        items: [{ id: CALENDAR_ID }],
      }),
    });

    const data = await res.json();
    const busy = data.calendars?.[CALENDAR_ID]?.busy || [];

    // Map each TIME_SLOT to blocked if it overlaps any busy period
    const blocked = TIME_SLOTS.filter(slot => {
      let [timePart, period] = slot.split(' ');
      let [h, m] = timePart.split(':').map(Number);
      if (period === 'PM' && h !== 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;

      const slotStart = new Date(`${date}T00:00:00`);
      slotStart.setHours(h, m, 0, 0);
      const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

      return busy.some(b => {
        const busyStart = new Date(b.start);
        const busyEnd   = new Date(b.end);
        return slotStart < busyEnd && slotEnd > busyStart;
      });
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ blocked }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
