# MineVerse v0.12

Modrinth + CurseForge mod yöneticisi. `npm install` → `npm start`.

## Yeni (v0.12)
- **Keşfet artık çok daha geniş.** Tür çubuğundan **Modlar / Mod paketleri / Shaderlar /
  Kaynak paketleri / Dünyalar** seç. Mod olmayan içerikler profil yerine oyun klasöründeki doğru
  alt klasöre kaydedilir (`shaderpacks`, `resourcepacks`, `saves`). Modrinth mod paketleri
  (.mrpack) tek tıkla **profil olarak içe aktarılır**. Dünyalar yalnızca CurseForge kataloğunda
  olduğundan o türde kaynak otomatik CurseForge'a kilitlenir.
- **Hazır duvar kağıtları + gerçekten çalışan özel arka plan.** Ayarlar → *Arka plan* kartındaki
  galeriden uygulamayla gelen 4 duvar kağıdından birini tek tıkla seç; karartma/bulanıklık/
  döşeme ayarlarıyla oyna. Bilgisayarından seçtiğin fotoğraf `custom-assets/background.png`
  olarak saklanır (v0.12'deki boyama sırası hatası giderildi; artık tema değiştirmek arka planı
  silmez).
- **Skinler Hesap sayfasında.** 6 hazır skin + kendi 64×64 PNG skinini yükleme; tıkla-önizle
  paperdoll çizimi (eski 64×32 biçimi de tanınır) ve **seçtiğin skinin kafasını profil
  fotoğrafın yapma**. Skinler `custom-assets/skins/` altında tutulur.
- **Yönetici paneli yenilendi.** Sol tarafta Başlık/Bağlantı/Etiket/Özet alanları, sağda
  görsel yükleme kutusu ve **canlı önizleme penceresi**. Haber görselleri Gist'e ayrı dosya
  olarak yüklenir; diğer MineVerse'ler haber kartında görseli görür.
- **Rozetler.** Ana sayfada bu bilgisayardaki ilerlemenden hesaplanan 8 rozet (ilk profil,
  10/50 mod, arkadaş, yedek, arka plan, skin, launcher…).
- **Ctrl+K komut paleti.** Sayfalar ve sık eylemler (profil klonla, yedek al, launcher algıla…)
  için klavye kısayolu.
- **Keşfet koleksiyon çipleri.** Modlar görünümünde tek tıkla "Performans canavarları",
  "Macera & RPG" gibi hazır filtreler.
- **Profil klonlama.** Kütüphane başlığındaki **Klonla** düğmesi profili ve mod dosyalarını
  aynen kopyalar.
- **Yeni fontlar.** Outfit (arayüz) ve JetBrains Mono (kod); Google Fonts yerine yerel
  woff2 — çevrimdışı da aynı görünüm, Türkçe karakterler tam destekli.

## Yeni (v0.11)
- **Arkadaşlık: tek adımlı davet.** Arkadaşlar sayfası → *Davet gönder* → **Davet kodu oluştur**.
  Üretilen `MVINV1:…` kodunu arkadaşına gönder; o da *Kod yapıştır (davet veya paket)* kartına
  atıp **Kodu oku**'na bassın, **Kabul et / Reddet** çıksın. İkinci bir onay turu yoktur.
  Arkadaşın sana sonra bir paket kodu (`MV1:…` *Paket gönder* / *Profil paylaşımı*) gönderdiğinde,
  senin bekleyen davetin otomatik olarak "kabul edildi" olur.
- **İstek geçmişi + reddedilenler.** *Sana gelen davetler*, *Gönderdiğin davetler*
  (**Kabul edildi işaretle / Vazgeç**), *Gelen kutusu* ve *İstek geçmişi* kartları. Aynı davet
  kodu ikinci kez işlenmez: kabul edildiyse "zaten kabul edilmişti", reddedildiyse "daha önce
  reddedilmiş" uyarısı çıkar.
- **Kod doğrulama + mükerrer engeli.** MV kodları `MV-XXXX-XXXX` biçiminde denetlenir (küçük harf,
  boşluk ve çizgisiz yazım otomatik düzeltilir; `0/O`, `1/I` uyarısı Türkçe verilir). Kendi kodun,
  bu bilgisayardaki başka bir hesabın kodu ve rehberinde olan biri eklenemez.
- **Arkadaştan paket alma / kolay gönderme.** Rehberindeki satırda **Paket gönder** (arkadaşın
  seçili olduğu için davetini kapatır) ve **Paket al**. Yapıştırılan paket kodu önce
  **önizleme** olarak açılır: ad, sürüm, yükleyici, mod listesi (ilk 12) ve "kimden" bilgisi.
  **Profil kur ve indir**'e basmadan hiçbir şey inmez.
- **Güvenlik sertleştirmesi** (aşağıdaki *Güvenlik* bölümüne bak): CSP, sandbox, gezinme/pencere
  kilidi, klasör açma beyaz listesi, gelen kod/zip denetimleri, indirme boyut sınırları.
- **CurseForge anahtarı kaynakta değil.** Depo (`GitHub`) paylaşımı için anahtar artık kodun
  içinde değil; bkz. *CurseForge API anahtarın*.

## Yeni (v0.10)
- **Oyun artık gerçekten açılıyor.** Başlatma çökerse neden çöktüğü görünür: tüm oyun çıktısı
  `<oyun klasörü>\logs\mineverse-son-baslatma.log` dosyasına yazılır. Ayarlar → *Başlatma günlüğü ve
  ön kontrol* kartında **Logu göster / Kopyala / Log dosyasını aç** düğmeleri ve son çıkış kodu var.
  Mojang'ın XML log yapılandırması yerine düz metin kullanan kendi `mineverse-log4j2.xml`'imiz yazılır,
  böylece `logs/latest.log` da okunur olur.
- **Başlatmadan önce uyumluluk ön kontrolü.** Oyna'ya bastığında profilin mod tek tek açılır;
  `fabric.mod.json`, `quilt.mod.json`, `META-INF/mods.toml`, `mcmod.info` içindeki sürüm aralıkları
  (`[1.20.1,)`, `>=1.20 <=1.20.4`, `1.20.x`, `~1.20.1` …) profilin sürümü/yükleyicisiyle karşılaştırılır.
  Uyumsuzlar modalda listelenir ve tek tıkla **Uyumsuz modları kapat ve başlat** yapılır.
  Ayrıca Ayarlar → *Profili kontrol et* ile elle çalıştırılabilir.
- **Launcher'a aktarım doğru klasöre yazıyor.** Launcher kaydı `%APPDATA%\.minecraft\versions` gibi
  alt klasörleri gösteriyorsa yol artık oyun köküne indirgenir; modlar **`<oyun kökü>\mods`**
  klasörüne yazılır ve (yoksa) `<oyun kökü>\versions\<sürüm>\<sürüm>.json` sürüm dosyası üretilir.
  Aktarım sonrası sonuç modalı kopyalanan/atlanan/başarısız modları ve tam hedef klasörü gösterir;
  Launcher'lar sayfasındaki kart "Modlar buraya yazılır: …" satırını basar.
- **Yeni vurgu (renk) seçimi.** Ayarlar → Tema → *Vurgu rengi*: 12 isimli renk, canlı önizleme,
  özel HEX seçici ve varsayılana dön. Metin kontrastı renk parlaklığına göre otomatik hesaplanır.
- **Kendi arka plan fotoğrafın.** Ayarlar → Tema → *Kendi arka plan fotoğrafın* → Fotoğraf seç.
  Dosya `custom-assets\background.png` olarak saklanır; karartma, bulanıklık, belirlilik ve döşeme
  kaydırıcılarıyla ayarlanır (`<img>` yüklenemezse uygulama görseli gizler, arayüz bozulmaz).
- **Yönetici haber paneli (yalnızca sende).** Ayarlar → *Yönetici paneli*. Girdiğin kodla açılır
  (varsayılan: `mineverse`), GitHub tokenınla bir **Gist** oluşturur, haberlerini oraya yayımlarsın;
  kurulu her MineVerse o Gist'i 30 dakikada bir okuyup Ana Sayfa → Haberler → **MineVerse**
  sekmesine koyar. İnternet yoksa son indirilen kopya (`news-feed.json`) gösterilir.
  Aşağıdaki *Yönetici haber paneli* bölümüne bak.

## Yönetici haber paneli
1. GitHub'da **gist** yazma yetkisi olan bir token oluştur (`gist` scope'u yeterli).
2. Ayarlar → Yönetici paneli → yönetici kodunu gir → **Panele gir**.
3. **GitHub token** alanına tokenı yaz, **Ayarları kaydet** bas.
4. İstersen ilk haberi ekleyip **Gist oluştur** bas — MineVerse Gist'i açar, kimliğini ve ham
   (raw) bağlantısını kendisi doldurur.
5. Sonraki haberler için: başlık/özet/etiket/emoji yaz → **Listeye ekle** → **GitHub'a yayımla**.
   Liste tarihe göre sıralanır ve 40 kayıtla sınırlı tutulur.

**Diğer herkes de görsün mü?** Onlara söyleyeceğin ham bağlantıyı sen biliyorsun. Herkeste otomatik
görünsün istersen `src/features.cjs` içindeki tek sabite yaz:

    const DEFAULT_NEWS_FEED_URL = 'https://gist.githubusercontent.com/kullanici/gist-id/raw/mineverse-news.json';

Bu sabit olmadan da panel çalışır; sadece senin makinende `newsFeedUrl` ayarından okunur.

**Güvenlik:** Token `state.json`'a hiç yazılmaz — `%APPDATA%\mineverse\mineverse\owner-secret.json`
içinde durur, arayüze yalnızca maskelenmiş hâli (`****xxxx`) gönderilir. Yönetici kodu bir güvenlik
sınırı değil, tek kullanıcıya kolay kilit.

## CurseForge API anahtarın
Kaynak kodda artık anahtar **yok**. Anahtar şu sırayla aranır:

1. `CURSEFORGE_API_KEY` ortam değişkeni (derleme/çalıştırma öncesi: `export CURSEFORGE_API_KEY=…`).
2. `build/secrets.json` → `{ "curseForgeApiKey": "…" }`  *(gitignore'da; depoya gitmez)*
3. Ayarlar → *CurseForge erişimi* kartına girdiğin anahtar (yalnızca bu bilgisayarda).

Klonlayıp `npm start` yapan biri 2. adımı böyle geçer:

    cp build/secrets.example.json build/secrets.json   # içine kendi anahtarını yaz

**Önemli:** `build/secrets.json` senin anahtarın olduğu için onu **kaynak zip'ine ve depoya koyma**.
Elektronik olarak ürettiğimiz teslim zip'inde bu dosya bilinçli olarak dışarıda tutulur; portable
.exe içinde ise uygulamanın çalışabilmesi için bulunur — bu exe'yi başkasına verirsen anahtarını da
vermiş olursun (bunu kabul ettin). Bu yüzden eski sürümlerde (`v0.7.0`–`v0.10.0`) düz metin hâlde
kalmış anahtarını **CurseForge tarafında iptal edip yenisini oluştur**.

## Güvenlik
- **CSP** (`src/renderer/index.html` içindeki `<meta http-equiv="Content-Security-Policy">`):
  betikler yalnızca uygulamayla gelen dosyalardan çalışır, satır içi betik ve `eval` kapalı;
  Form/iframe/nesne yüklemesi kapalı. Arayüzde hiç `fetch`/`eval` yok, bağlantılar ana süreçte açılır.
- **Sandbox + yalıtım:** `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
  Arayüz yalnızca `preload.cjs`'teki adlandırılmış çağrıları kullanabilir.
- **Gezinme/pencere kilidi:** pencere kendi `index.html`'i dışına gidemez, `window.open` ve
  `<webview>` reddedilir. Dış bağlantılar yalnızca `https:` ise tarayıcıda açılır.
- **Klasör açma beyaz listesi** (`system:openPath`): yalnızca MineVerse veri klasörü, userData,
  `~/.minecraft` ve bağlı launcher kökleri açılabilir; çalıştırılabilir uzantılar (`.exe .bat .cmd
  .jar .ps1 .lnk …`) ve null byte'lı yollar reddedilir.
- **Gelen kodlarda doğrulama:** `MV1:` ve `MVINV1:` gövdeleri sadece şişirilmiş-sınırlı (deflate,
  en fazla 1 MB / 64 KB çıktı) okunur; alan uzunlukları kırpılır, `mods` listesi 300 ile sınırlı,
  yalnızca Modrinth/CurseForge sürüm kimlikleri kabul edilir. Paket kodundan **doğrudan dosya
  yazılmaz**; her mod resmî API üzerinden, sha1 doğrulamalı ve en fazla 512 MB indirme tavanıyla iner.
- **Zip güvenliği:** Java kurulumu ve yedek geri yükleme `extractZipTo()` üzerinden çalışır — yol
  geçişi (`../`), tek kayıt boyutu (≤120–200 MB) ve toplam kota (2 GB) denetlenir; `.mrpack`
  içe alımında 400 dosya ve 100 MB tek dosya sınırı vardır.
- **Bozuk state.json çökme yaratmaz:** okuma hatasında varsayılana dönülür, yazma atomik
  (tmp → rename) yapılır.
- **asar paketleme:** `asar: true`; kaynak dosyaları `resources/app.asar` içinde tek arşivdir.

## Derleme / paketleme
    npm run check        # tüm kaynak dosyalarında sözdizimi denetimi
    npm run dist:win     # release\MineVerse-<sürüm>-win.exe (portable) + .zip
    npm start            # geliştirme çalıştırması

`ELECTRON_RUN_AS_NODE` tanımlıysa `npm start`/derleme bozulur; önce kapat.

## Yeni (v0.9)
- **Gerçek oyun başlatma.** Ayarlar → *Oyunu başlatma* → "MineVerse başlatsın". MineVerse kendi
  yönetilen klasörüne (`%APPDATA%\mineverse\mineverse\minecraft`) sürüm dosyalarını, kütüphaneleri,
  varlıkları ve Java'yı indirir ve Minecraft'ı doğrudan açar. Vanilla ve Fabric tam destekli;
  Forge/NeoForge ancak daha önce resmî launcher ile bir kez kurulmuşsa çalışır (kullanıcının
  `.minecraft/versions` klasöründeki sürüm dosyası miras zinciriyle birleştirilir). "Launcher'a
  aktarıp aç" seçeneği eski davranış olarak korundu.
- **Hesap sistemi (Hesabım sayfası + kenar çubuğu kartı).** Kalıcı bir hesap UUID'si üretilir ve
  bunun okunabilir hâli **MV kodu** (`MV-XXXX-XXXX`) olur; arkadaşların sana paket gönderirken bu
  kodu kullanır. Oyun UUID'si ise Minecraft'ın kendi çevrim dışı kuralıyla adından türetilir
  (`md5("OfflinePlayer:"+ad)`), yani adı değiştirirsen oyun UUID de değişir — bu beklenen
  davranıştır. Sunucu/çevrimiçi hesap yoktur, her şey yerelde kalır. Eski `settings.account`
  verisi ilk açılışta otomatik taşınır.
- **Eksik bağımlılıkları tek tıkla kur.** Kütüphane → Analiz et → "N eksik bağımlılığı kur".
  Modrinth'ten profilin sürümüne/yükleyicisine uygun sürüm seçilir, kurulamayanlar ayrı listede
  gösterilir.
- **Arayüz ikonlarının tamamı fotoğrafla değiştirilebilir** (aşağıya bak).
- Kenar çubuğundaki "Sistem durumu" kartı ve Ayarlar'daki eski "Hesap" kartı kaldırıldı.

## İkonları / emojileri fotoğraf ile değiştirme
Kenar çubuğu, düğme ve kart başlığındaki her simge bir **anahtar**dır (`nav-home`, `act-download`,
`card-accounts` …). Anahtar resmi bulunursa fotoğraf, bulunmazsa emoji kullanılır — dosya eksikse
uygulama bozulmaz.

    npm run icons            # tüm anahtarların listesi + hazır komutlar

**1) Derleme yapmadan:** Ayarlar → Özel görseller → klasörü aç → içine `ui/nav-home.png` koy
(alt klasör adı `ui` olmalı). Uygulamayı yeniden aç.
**2) Kaynak koddan:**

    npm run asset -- ui:nav-home ./ikonum.png   # 48x48 PNG'ye çevirir, assets/ui/ içine yazar

**3) Paketlenmiş sürüm:** kaynak `resources/app.asar` içinde olduğundan derlenmiş uygulamaya dosya
koşamazsın; 1. yöntemi (Ayarlar → Özel görseller → klasörü aç) kullan.

## Görsel / texture değiştirme (hata vermeden)
**1) Uygulama içinden (derleme gerekmez):** Ayarlar → Özel görseller → klasörü aç.
Buraya `blocks/grass.png`, `logo-128.png`, `star-32.png`, `ui/nav-home.png` gibi, uygulamadakiyle AYNI yol/adla resim koy.
Bozuk resim uygulamayı bozmaz; orijinali kullanılır.

**2) Kaynak koddan:** `src/renderer/assets/` içindeki dosyaları değiştir. Herhangi bir resmi doğru
boyut/biçime çevirmek için:

    npm run asset -- block:grass ./cim.jpg     # blocks/grass.png (64x64)
    npm run asset -- ui:nav-home ./ikon.png    # ui/nav-home.png (48x48)
    npm run asset -- logo ./logom.png          # logo + uygulama ikonu (.ico) hepsi
    npm run asset -- star ./yildiz.png
    npm run icon  -- ./resim.png               # sadece build/icon.ico

**3) Paketlenmiş sürüm:** `win-unpacked` derlemesi artık `resources/app.asar` arşivi kullanır
(dosyalar tek arşivin içinde). Kalıcı görsel değişikliği için 1. yöntemi kullan; tek dosyalık
portable .exe her açılışta geçici klasöre açıldığı için orada yapılan değişiklikler kalıcı olmaz.

## Notlar
- Arkadaş kodları yerel rehberdir; çevrimiçi hesap/sunucu yoktur. Paketler `MV1:…`, davetler
  `MVINV1:…` kodu ile taşınır — her ikisi de yalnızca senin gönderdiğin metindir, hiçbir yere
  yüklenmez.
- MineVerse ile başlatma çevrim dışı (`legacy`) hesapla çalışır: oturum açıkken oynarsan ilerlemen
  yalnızca bu bilgisayardaki profilinde kalır.
- Kod imzalama sertifikası yoktur; Windows SmartScreen uyarısı normaldir.
