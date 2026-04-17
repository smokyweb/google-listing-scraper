const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');

const US_STATES = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' }, { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' }, { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' }, { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' }, { code: 'DC', name: 'District of Columbia' }
];

router.get('/states', authMiddleware, (req, res) => {
  res.json(US_STATES);
});

// GET /api/locations/cities?state=TX&minPop=100000
router.get('/cities', authMiddleware, async (req, res) => {
  const { state, minPop = 100000 } = req.query;
  if (!state) return res.status(400).json({ error: 'state required' });

  try {
    // Use the US Census / Wikidata API via a public cities dataset
    const url = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/us-cities-demographics/records?where=state_code="${state.toUpperCase()}"&select=city,count&group_by=city&order_by=count%20desc&limit=100`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (resp.ok) {
      const data = await resp.json();
      const cities = (data.results || [])
        .filter(r => (r.count || 0) >= Number(minPop))
        .map(r => ({ name: r.city, population: r.count }))
        .sort((a, b) => b.population - a.population);
      return res.json(cities);
    }
  } catch (e) {
    console.error('Cities API error:', e.message);
  }

  // Fallback: hardcoded major cities per state
  const MAJOR_CITIES = {
    TX: [{ name: 'Houston', population: 2304580 }, { name: 'San Antonio', population: 1434625 }, { name: 'Dallas', population: 1304379 }, { name: 'Austin', population: 961855 }, { name: 'Fort Worth', population: 918915 }, { name: 'El Paso', population: 678815 }, { name: 'Arlington', population: 398854 }, { name: 'Corpus Christi', population: 317863 }, { name: 'Plano', population: 288142 }, { name: 'Laredo', population: 255205 }],
    CA: [{ name: 'Los Angeles', population: 3898747 }, { name: 'San Diego', population: 1386932 }, { name: 'San Jose', population: 1013240 }, { name: 'San Francisco', population: 873965 }, { name: 'Fresno', population: 542107 }, { name: 'Sacramento', population: 513624 }, { name: 'Long Beach', population: 466742 }, { name: 'Oakland', population: 440646 }, { name: 'Bakersfield', population: 403455 }, { name: 'Anaheim', population: 346824 }],
    FL: [{ name: 'Jacksonville', population: 949611 }, { name: 'Miami', population: 467963 }, { name: 'Tampa', population: 399700 }, { name: 'Orlando', population: 309154 }, { name: 'St. Petersburg', population: 265351 }, { name: 'Hialeah', population: 223109 }, { name: 'Port St. Lucie', population: 204851 }, { name: 'Cape Coral', population: 194016 }, { name: 'Tallahassee', population: 196169 }, { name: 'Fort Lauderdale', population: 182760 }],
    NY: [{ name: 'New York City', population: 8336817 }, { name: 'Buffalo', population: 278349 }, { name: 'Rochester', population: 211328 }, { name: 'Yonkers', population: 211464 }, { name: 'Syracuse', population: 148620 }, { name: 'Albany', population: 99224 }],
    IL: [{ name: 'Chicago', population: 2696555 }, { name: 'Aurora', population: 180542 }, { name: 'Joliet', population: 150362 }, { name: 'Naperville', population: 149540 }, { name: 'Rockford', population: 148655 }, { name: 'Springfield', population: 114230 }],
    TN: [{ name: 'Nashville', population: 689447 }, { name: 'Memphis', population: 633104 }, { name: 'Knoxville', population: 190740 }, { name: 'Chattanooga', population: 181099 }, { name: 'Clarksville', population: 166722 }],
    GA: [{ name: 'Atlanta', population: 498715 }, { name: 'Columbus', population: 206922 }, { name: 'Augusta', population: 202081 }, { name: 'Macon', population: 157346 }, { name: 'Savannah', population: 147780 }],
    OH: [{ name: 'Columbus', population: 905748 }, { name: 'Cleveland', population: 372624 }, { name: 'Cincinnati', population: 309317 }, { name: 'Toledo', population: 270871 }, { name: 'Akron', population: 190469 }],
    NC: [{ name: 'Charlotte', population: 874579 }, { name: 'Raleigh', population: 467665 }, { name: 'Greensboro', population: 296710 }, { name: 'Durham', population: 278993 }, { name: 'Winston-Salem', population: 249545 }],
    AZ: [{ name: 'Phoenix', population: 1608139 }, { name: 'Tucson', population: 542629 }, { name: 'Mesa', population: 504258 }, { name: 'Chandler', population: 261165 }, { name: 'Scottsdale', population: 258069 }],
  };

  const cities = (MAJOR_CITIES[state.toUpperCase()] || []).filter(c => c.population >= Number(minPop));
  res.json(cities);
});

module.exports = router;
