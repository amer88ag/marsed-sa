# تكامل خرائط Google وGoogle Earth

## قرار التنفيذ الأولي

يضيف المرصد روابط سياقية إلى Google Maps وGoogle Earth انطلاقاً من إحداثيات سجل المدن الموحد، مع تصدير نقاط المدن إلى KML لفتحها في Google Earth. هذه طبقة مساعدة؛ لا تستبدل خريطة Leaflet الحالية ولا مصادر البيانات المفتوحة.

## ما نفعّله الآن

- رابط Google Maps للمدينة المحددة باستخدام Maps URLs؛ لا يحتاج مفتاح API.
- رابط Google Earth لفتح إحداثيات المدينة في واجهة Earth على الويب.
- تصدير جميع نقاط مجموعة لوحة المدن إلى ملف KML.
- رابط اتجاهات Google Maps بين نقطتين عند الحاجة، من دون الادعاء بأن المرصد يحسب حركة المرور الحية.

## ما لا نفعّله تلقائياً

- لا نضمّن خريطة Google تفاعلية داخل الصفحة في هذه المرحلة.
- لا نفعّل Maps JavaScript API أو Map Tiles API أو Elevation API المدفوعة.
- لا نستخدم صور Google كطبقات tiles في Leaflet ولا نخزنها أو نعيد توزيعها.
- لا نستعمل Google Earth Engine في تشغيل المرصد قبل التحقق من أهلية الاستخدام والترخيص والتكلفة.

## التكلفة والمفاتيح

Maps Embed API متاحة دون رسوم على الطلبات، لكن تتطلب API key وحساب فوترة مفعلاً. إذا أضيف تضمين iframe لاحقاً، يجب إنشاء مفتاح مخصص مقيد بنطاقات المرصد وبـ Maps Embed API فقط، مع مراقبة الحصص والتنبيهات. لا يوضع المفتاح في مستودع GitHub قبل ضبط القيود، ولا نحتاجه للروابط الخارجية أو تصدير KML.

## حدود الدقة والتفسير

- إحداثيات المدن نقاط مرجعية في سجل المرصد، وليست حدوداً إدارية أو مركزاً سكانياً دقيقاً.
- Google Earth imagery ليست بثاً حياً؛ تاريخ الصورة ودقتها يختلفان بحسب المكان.
- KML يصدّر النقاط المسجلة فقط ولا يضيف بيانات طقس أو أمطار.
- أي تحليل علمي للغطاء النباتي أو المياه يجب أن يستخدم منتجات فضائية موثقة المصدر والتاريخ والدقة والترخيص، لا الانطباع البصري من صورة Google.

## المراجع الرسمية

- Google Maps URLs: https://developers.google.com/maps/documentation/urls/get-started
- Maps Embed API usage and billing: https://developers.google.com/maps/documentation/embed/usage-and-billing
- Maps Embed API quick reference: https://developers.google.com/maps/documentation/embed/quick-reference
- Google Earth quick reference: https://developers.google.com/maps/documentation/earth/quick-reference
- Google Earth Engine noncommercial eligibility: https://earthengine.google.com/noncommercial/

## الخطوة التالية بعد الاختبار

اختبار الروابط وملف KML على الهاتف والكمبيوتر، ثم دراسة تضمين Maps Embed اختيارياً بعد تجهيز مفتاح Google Cloud مقيد. لا يلزم اشتراك Maps مدفوع للروابط الخارجية أو KML.
