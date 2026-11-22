# سجل مصادر البيانات والتراخيص

آخر تحقق من المصادر الرسمية: 2026-11-21.

هذا السجل يميز بين وجود مصدر بيانات وبين السماح القانوني باستخدامه داخل مرصد عام. يجب اعتماد المنتج والإصدار المحددين، لا اسم الجهة فقط.

| المصدر / المنتج | الاستخدام المرشح | ما تحقق رسمياً | القرار الحالي |
|---|---|---|---|
| CHIRPS v3 | الأمطار اليومية التاريخية | مركز CHC يذكر تغطية من 1981 إلى قرب الحاضر، شبكة 0.05°، ومنتجين preliminary وfinal. كتالوج Google Earth Engine لمنتجي CHIRPS V3 DAILY SAT وDAILY RNL يصف البيانات بأنهما Public Domain، وصفحة CHC العامة تشير إلى الإسناد وفق CC BY 4.0. | مرشح قوي لطبقة تاريخية بعد تحديد المنتج وطريقة الاستخراج والتحقق من القيم والتغطية |
| NASA GPM IMERG | الأمطار شبه الآنية والتاريخية | NASA توضح دقة مكانية 0.1° ودقة زمنية 30 دقيقة. Early وLate للزمن القريب، وFinal أعلى جودة لكنه يتأخر أكثر. | مرشح للمقارنة والتحقق، ويجب توثيق نسخة المنتج وزمن التأخر والوحدات |
| المركز الوطني للأرصاد NCM API | بيانات الرصد والتوقعات والإنذارات الرسمية | وثائق API تتطلب اسم مستخدم وكلمة مرور بعد التسجيل. خدمة الربط المباشر مصنفة Commercial، وصفحة الخدمة الوطنية تشير إلى طلب الخدمة والرسوم عبر سداد. | لا نفترض أنه مجاني أو متاح دون موافقة. نطلب عرضاً وشروطاً مكتوبة قبل أي تكامل |
| Open-Meteo | مؤشرات الطقس النموذجية في النموذج الأولي | الخطة المجانية للاستخدام غير التجاري حتى 10,000 طلب يومياً، وبيانات API مرخصة CC BY 4.0 مع الإسناد. القيم مخرجات نموذج وليست قياسات محطة NCM. | مصدر مساعد مؤقت؛ يجب إظهار الإسناد قرب القيم ومراجعة شروط الاستخدام وحدود الطلب قبل الإطلاق |
| GEOSA — الخريطة الوطنية الرسمية | حدود المملكة والمناطق الإدارية | الهيئة تؤكد المرجعية الرسمية للحدود، لكن شروط المنصة واتفاقية استخدام البيانات تقيد النسخ والتوزيع والعرض العام دون موافقة خطية مسبقة في الحالات المحددة. وجود الطبقة أو كون سعر بعض البيانات مجانياً لا يمنح تلقائياً حق إعادة نشرها. | لا ننسخ أو نعرض طبقة GEOSA داخل مرصد عام قبل موافقة خطية وشروط ترخيص صريحة؛ نبحث عن بديل مفتوح يسمح بإعادة الاستخدام |

## مراجع رسمية

### CHIRPS v3
- مركز مخاطر المناخ بجامعة كاليفورنيا سانتا باربرا: https://www.chc.ucsb.edu/data/chirps3
- كتالوج Google Earth Engine لمنتج DAILY SAT وشروطه: https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHC_CHIRPS_V3_DAILY_SAT
- كتالوج Google Earth Engine لمنتج DAILY RNL وشروطه: https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHC_CHIRPS_V3_DAILY_RNL
- كتالوج منتج DAILY RNL: https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHC_CHIRPS_V3_DAILY_RNL

ملاحظة منهجية: لا نخلط بين DAILY SAT وDAILY RNL أو المنتج النهائي. يجب تخزين اسم المنتج وإصداره وتاريخ التحديث مع كل سجل أو طبقة. صفحة CHC تذكر الإسناد وفق CC BY 4.0؛ نحافظ على الإسناد والاستشهاد حتى مع وصف كتالوج Earth Engine للمنتجات بأنها ضمن الملك العام.

### NASA GPM IMERG
- صفحة المنتج الرسمية: https://gpm.nasa.gov/data/imerg
- الأسئلة الشائعة حول الدقة والتأخر: https://gpm.nasa.gov/resources/faq
- يجب تحديد Early أو Late أو Final صراحة في وصف كل طبقة.

### الهيئة العامة للمساحة والمعلومات الجيومكانية GEOSA
- الخريطة الوطنية الرسمية: https://geosa.gov.sa/en/About/Pages/OfficialSaudiMap.aspx
- المنصة الجيومكانية الوطنية: https://geoportal.sa/
- شروط الاستخدام وحقوق الملكية: https://www.geoportal.sa/Geoportal/TermsOfUse
- اتفاقية استخدام البيانات الجيومكانية: https://apps.geoportal.sa/pdfs/GEOSA-User-Agreement.pdf
- إطار الحوكمة يذكر أن طبقة Administrative Regions من الطبقات الأساسية، وأن بعض فئات البيانات قد تكون مجانية؛ لكن ذلك لا يلغي شروط اتفاقية الاستخدام ولا يمنح حق إعادة التوزيع.
- قرار المرصد: لا نسخ أو نشر أو تضمين طبقة GEOSA في واجهة عامة قبل إذن خطي محدد. لا نعتبر توفرها أو مجانية سعرها ترخيصاً مفتوحاً.
- لا تستخدم حدوداً إدارية مجهولة المصدر عند تمثيل المناطق والمحافظات.

### Open-Meteo
- التوثيق: https://open-meteo.com/en/docs
- الترخيص والإسناد: https://open-meteo.com/en/license
- البيانات وفق CC BY 4.0، ويجب وضع إسناد واضح بجوار موضع عرض البيانات.
- الاستخدام المجاني محدد بالاستخدام غير التجاري؛ الاستخدام التجاري أو الأحجام الأعلى يحتاجان إلى خطة مناسبة.

### المركز الوطني للأرصاد
- بدء استخدام API: https://api-doc.ncm.gov.sa/en/api/getting-started
- توثيق الطلبات: https://api-doc.ncm.gov.sa/en/api/request
- خدمة الربط المباشر: https://www.ncm.gov.sa/en/services/our-services/direct-api-integration
- طلب الخدمة: https://www.ncm.gov.sa/ar/e-services/request-services?service=32137
- صفحة الخدمة الوطنية التي تعرض إجراءات الطلب والرسوم: https://my.gov.sa/en/services/2833082

## شروط اعتماد أي مصدر

1. رابط رسمي مباشر للبيانات وشروط الاستخدام.
2. تحديد اسم المنتج والإصدار وتاريخ الحصول عليه.
3. تحديد ما إذا كان الاستخدام والعرض العام والتنزيل وإعادة التوزيع مسموحاً كلٌ على حدة.
4. تحديد متطلبات الإسناد وإشعارات حقوق النشر.
5. تسجيل الدقة المكانية والزمنية والتغطية والتأخر والوحدات.
6. تنفيذ اختبار عينة داخل حدود المملكة ومقارنة النتائج بمصدر مستقل أو محطة أرضية عند توفرها.
7. تسجيل تاريخ المراجعة وقرار: معتمد، معتمد بشروط، أو مرفوض.

## القرار الحالي

- CHIRPS v3 مرشح أولي مناسب للتحليل التاريخي، لكن اختيار منتج DAILY SAT أو RNL أو النهائي يجب أن يكون صريحاً ومختبراً.
- IMERG مرشح للمقارنة الزمنية وشبه الآنية، مع إظهار نوع التشغيل والتأخر.
- NCM مصدر رسمي مهم، لكن التكامل التجاري أو المقيد لا يبدأ قبل الموافقة ومعرفة الرسوم وشروط إعادة العرض.
- لا نطلق تنبيهات سيول أو إنذارات سلامة اعتماداً على هذه الطبقات وحدها.

## CHIRPS v3 RNL historical COG access

- The official CHC daily archive distributes global GeoTIFF files; the existing point extractor downloads each full raster for every date and is therefore unsuitable for broad multi-year runs.
- A separate WFP Source Cooperative distribution exposes CHIRPS v3 RNL daily files as Cloud-Optimized GeoTIFFs (COGs), indexed by a public STAC GeoParquet file. The index supports bounding-box and datetime filtering, and COG access can read only the required raster windows.
- The new historical extractor queries the Saudi bounding box and samples the 13 configured city points from each daily COG. It emits RNL only; it does not imply SAT is available from this distribution.
- The archive is an RNL gridded estimate based on ERA5 daily disaggregation, not a rain-gauge observation. It uses nearest grid-cell sampling, not city-area averages. Missing dates or pixels remain null.
- Each run is limited to 366 days and produces a review artifact only. No historical data is committed to the repository or published automatically.
- Attribution and product-specific license metadata are retained in the output. Verify provider terms and source availability during each live extraction.
