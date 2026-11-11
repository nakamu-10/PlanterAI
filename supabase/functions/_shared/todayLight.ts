// 返事のプロンプトに渡す「今日の日照」。dailyLightJob が emotion_logs に入れた
// 今日の判定を言葉にする。返事は最新の emotion_logs（今の状態）しか見ないので、
// これが無いと、夜に「光足りなかったね」と言われても認められない（#89）

import { jstHour } from "./dailyLight.ts";
import { describeWeather, type TodayWeather } from "./weather.ts";

interface DailyLightScore {
  kind?: string;
  ratio?: number;
  weather?: TodayWeather | null;
}

export function describeTodayLight(
  scores: unknown,
  createdAt: string,
): string | null {
  const light = (scores as { daily_light?: DailyLightScore } | null)
    ?.daily_light;
  if (!light || typeof light.ratio !== "number") return null;
  const percent = `目標の${Math.round(light.ratio * 100)}%`;

  switch (light.kind) {
    case "warning":
      return `${
        jstHour(new Date(createdAt))
      }時の時点で、今日浴びた光は${percent}で、このままだと今日は足りなさそう。まだ今日は終わっていない。`;
    case "shortfall":
      return `今日浴びた光は${percent}で、足りなかった。`;
    case "dim_day": {
      const weather = light.weather
        ? `${describeWeather(light.weather)}で、日が差したのは${
          light.weather.sunshineHours.toFixed(1)
        }時間だけ。`
        : "曇りや雨で、";
      return `今日は${weather}今日浴びた光は${percent}で足りなかったが、天気のせいで、置き場所や飼い主のせいではない。`;
    }
    case "recovered":
      return `足りなさそうだと伝えたあと、今日浴びた光は${percent}になり、目標に届いた。`;
    default:
      return null;
  }
}
