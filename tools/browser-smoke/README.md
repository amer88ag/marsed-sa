# فحوص المتصفح المحلية (Chrome حقيقي)

أدوات تطوير محلية فقط؛ **لا تعمل في GitHub Actions** ولا تتصل بأي خدمة خارجية.

| السكربت | ما يثبته | ما لا يثبته |
|---|---|---|
| `smoke.js` | تحميل الصفحات الست (index، seasons، elevation، satellite، coverage، admin) بعرض 390px دون أخطاء JavaScript أو تجاوز أفقي، مع خدمات محاكاة | أي شيء عن الخدمات الحية. بلاطات الأقمار **محجوبة عمداً** فيه، لذلك يظهر فحص التغطية «فشل/مهلة 76 من 76»: هذا يثبت أن الصفحة تعرض الفشل بأمانة فقط |
| `coverage-real-cors.js` + `cors-servers.py` | تحليل بكسلات البلاطات داخل Chrome مع تطبيق CORS فعلياً، عبر خادمين محليين حقيقيين على أصلين مختلفين: صالحة، جزئية، فارغة، ودون CORS = «حُمّلت دون تحقق» | توفر NASA GIBS الحي أو محتوى صوره الحقيقية |
| `cors-probe.js` | يوثق أن `route.fulfill` في Playwright **يتجاوز CORS**، ولذلك لا يصلح لاختبار CORS | — |

ملاحظة الاختبار فقط: `cors-servers.py` يوجّه عنوان GIBS في `nasa-gibs.js` إلى الخادم المحلي **أثناء التقديم فقط**، ولا يعدّل الملف في المستودع.

## التشغيل

```
npm i leaflet@1.9.4 playwright
```

```
node smoke.js > chrome-smoke.log
```

```
node make-tiles.js && (python3 cors-servers.py ../.. & sleep 1; node coverage-real-cors.js > coverage-real-cors.log; kill %1)
```
