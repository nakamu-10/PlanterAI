import { validateRawReading } from "../supabase/functions/_shared/validation.ts";

let pass = 0;
let fail = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log(`PASS ${name}`);
  } else {
    fail++;
    console.log(`FAIL ${name}`);
  }
}

const normal = { soil_adc: 2100, temp: 24, humidity: 55, lux: 2000 };

assert("正常なセンサー値を受理する", validateRawReading(normal).ok);
{
  const r = validateRawReading({ ...normal, temp: 180.1 });
  assert(
    "気温180.1℃は欠測（null）として受理する",
    r.ok && r.reading.temp === null && r.reading.soil_adc === 2100,
  );
}
{
  const r = validateRawReading({ soil_adc: 2100, temp: null, lux: 2000 });
  assert(
    "BME280が欠測（null・欠落）でも土壌水分と照度は受理する",
    r.ok && r.reading.temp === null && r.reading.humidity === null,
  );
}
{
  const r = validateRawReading({ ...normal, pressure: -154.3 });
  assert(
    "気圧の異常値は欠測（null）として受理する",
    r.ok && r.reading.pressure === null,
  );
}
assert(
  "湿度100%は受理する",
  validateRawReading({ ...normal, humidity: 100 }).ok,
);
{
  const r = validateRawReading({ ...normal, humidity: 100.1 });
  assert(
    "湿度100%超は欠測（null）として受理する",
    r.ok && r.reading.humidity === null,
  );
}
assert(
  "負の照度を拒否する",
  !validateRawReading({ ...normal, lux: -1 }).ok,
);
assert(
  "ADC範囲外を拒否する",
  !validateRawReading({ ...normal, soil_adc: 4096 }).ok,
);
assert(
  "必須項目（照度）の欠落を拒否する",
  !validateRawReading({ soil_adc: 2100, temp: 24, humidity: 55 }).ok,
);
assert(
  "任意の気圧を物理範囲内なら受理する",
  validateRawReading({ ...normal, pressure: 1013 }).ok,
);

console.log(`\n結果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
