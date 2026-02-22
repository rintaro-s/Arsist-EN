# サンプル 02: リアルタイム天気表示

OpenWeatherMap API から気温を取得し、10 秒ごとに UI を更新します。

## 設定

| 項目 | 値 |
|---|---|
| トリガー | `interval` |
| 間隔 | `10000` (10 秒) |
| スクリプト名 | `WeatherDisplay` |

## 事前準備

1. [OpenWeatherMap](https://openweathermap.org/api) で無料 API キーを取得
2. UI エディタで以下の要素を作成し Binding ID を設定:

| Binding ID | 要素タイプ | 用途 |
|---|---|---|
| `cityName` | Text | 都市名 |
| `temperature` | Text | 気温 |
| `weatherDesc` | Text | 天気の説明 |
| `weatherPanel` | Panel | 背景パネル |

## コード

```javascript
// 10 秒ごとに気温を取得して表示するスクリプト

var API_KEY = 'YOUR_API_KEY_HERE';  // OpenWeatherMap API キーに変更
var CITY = 'Tokyo';

var url = 'https://api.openweathermap.org/data/2.5/weather?q=' + CITY + '&appid=' + API_KEY + '&units=metric&lang=ja';

api.get(url, function(res) {
  if (res === null) {
    ui.setText('weatherDesc', '取得失敗');
    ui.setColor('temperature', '#FF0000');
    return;
  }

  var data = JSON.parse(res);

  var tempC = Math.round(data.main.temp);
  var desc = data.weather[0].description;
  var city = data.name;

  ui.setText('cityName', city);
  ui.setText('temperature', tempC + '°C');
  ui.setText('weatherDesc', desc);

  // 温度に応じて色を変更
  if (tempC >= 30) {
    ui.setColor('temperature', '#FF5733');  // 暑い: オレンジ
  } else if (tempC >= 20) {
    ui.setColor('temperature', '#FFC300');  // 温暖: 黄
  } else if (tempC >= 10) {
    ui.setColor('temperature', '#FFFFFF');  // 普通: 白
  } else {
    ui.setColor('temperature', '#AED6F1');  // 寒い: 水色
  }

  log('天気更新: ' + city + ' ' + tempC + '°C ' + desc);
});
```
