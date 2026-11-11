// Server-only Shiprocket serviceability adapter. No customer orders or shipments are created here.
// Docs: https://apidocs.shiprocket.in/
const BASE = 'https://apiv2.shiprocket.in/v1/external';
const pin = value => /^\d{6}$/.test(String(value ?? ''));
const fail = message => { throw new Error(message); };
export function shiprocketConfigured(env = process.env) {
  return Boolean(env.SHIPROCKET_API_EMAIL && env.SHIPROCKET_API_PASSWORD && pin(env.SHIPROCKET_PICKUP_PINCODE));
}
export function createShiprocketClient({env = process.env, fetchImpl = fetch} = {}) {
  let cached = null;
  let expires = 0;
  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetchImpl(BASE + path, {...options, signal:controller.signal});
      if (!response.ok) fail('Shiprocket API unavailable (' + response.status + ').');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function token() {
    if (!shiprocketConfigured(env)) fail('Shiprocket API configuration is incomplete.');
    if (cached && Date.now() < expires) return cached;
    const data = await request('/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({email:env.SHIPROCKET_API_EMAIL,password:env.SHIPROCKET_API_PASSWORD})
    });
    if (typeof data.token !== 'string' || !data.token) fail('Shiprocket authentication failed.');
    cached = data.token;
    // Rotate early; provider tokens normally last 10 days.
    expires = Date.now() + 9 * 24 * 60 * 60 * 1000;
    return cached;
  }
  async function checkCod({deliveryPincode, weightKg}) {
    if (!pin(deliveryPincode)) fail('Enter a valid six-digit delivery PIN code.');
    if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > 100) fail('Confirm the shipment weight in kilograms.');
    const query = new URLSearchParams({
      pickup_postcode:String(env.SHIPROCKET_PICKUP_PINCODE),
      delivery_postcode:String(deliveryPincode),
      cod:'1',weight:String(weightKg)
    });
    const data = await request('/courier/serviceability/?' + query, {
      headers:{Authorization:'Bearer ' + await token()}
    });
    const couriers = data?.data?.available_courier_companies;
    if (!Array.isArray(couriers)) fail('Courier serviceability could not be verified.');
    const eligible = couriers.filter(c => Number(c.cod) === 1 && Number(c.blocked || 0) === 0 &&
      Number.isInteger(Number(c.courier_company_id)) && Number(c.courier_company_id) > 0);
    return {serviceable:eligible.length > 0, couriers:eligible.map(c=>({
      courierId:Number(c.courier_company_id),
      name:String(c.courier_name || '').slice(0,100),
      estimatedDays:c.estimated_delivery_days ?? null,
      freightCharge:c.freight_charge ?? null,
      codCharges:c.cod_charges ?? null
    }))};
  }
  return {checkCod};
}
