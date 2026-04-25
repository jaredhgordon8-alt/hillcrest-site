const { JWT } = require('google-auth-library');

const CLIENT_EMAIL = process.env.GOOGLE_CLIENT_EMAIL;
const PRIVATE_KEY  = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const CALENDAR_ID  = process.env.GOOGLE_CALENDAR_ID;

const TIME_SLOTS = [
  '9:00 AM','10:00 AM','11:00 AM',
  '12:00 PM','1:00 PM','2:00 PM',
  '3:00 PM','4:00 PM','5:00 PM'
];

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
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'date param required' }) };
  }

  try {
    // Use google-auth-library to handle auth — no manual OpenSSL needed
    const auth = new JWT({
      email: CLIENT_EMAIL,
      key: PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    const token = await auth.getAccessToken();
    const accessToken = token.token;

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
    console.error('Calendar error:', err.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
