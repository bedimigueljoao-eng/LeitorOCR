package com.roletavision.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Color;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;
import java.util.Locale;

/**
 * Armazena perfis de ROI (x, y, w, h), modo do Bac Bo, estado de debug visual
 * e perfis de cor HSV calibráveis por casa/site (ex: kwanzabet, creedroomz, evolution).
 */
public class RoiConfigStore {

    public static final String PREFS_NAME = "roletavision_browser";

    public static final String GAME_ROULETTE = "roulette";
    public static final String GAME_BACBO = "bacbo";
    public static final String GAME_AVIATOR = "aviator";

    public static final String BACBO_MODE_AUTO = "auto";
    public static final String BACBO_MODE_BLOCKS = "blocks";
    public static final String BACBO_MODE_BEAD_PLATE = "bead_plate";

    public static final String SURFACE_SPLIT = "split";
    public static final String SURFACE_PROJECTION = "projection";

    private static final float MIN_ROI_WIDTH = 0.08f;
    private static final float MIN_ROI_HEIGHT = 0.03f;
    private static final float MAX_ROI_RATIO = 1.0f;

    public static class RoiRect {
        public final float leftRatio;
        public final float topRatio;
        public final float widthRatio;
        public final float heightRatio;

        public RoiRect(float leftRatio, float topRatio, float widthRatio, float heightRatio) {
            this.leftRatio = clamp(leftRatio, 0f, 0.92f);
            this.topRatio = clamp(topRatio, 0f, 0.95f);
            this.widthRatio = clamp(widthRatio, MIN_ROI_WIDTH, MAX_ROI_RATIO - this.leftRatio);
            this.heightRatio = clamp(heightRatio, MIN_ROI_HEIGHT, MAX_ROI_RATIO - this.topRatio);
        }

        public JSONObject toJson() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("leftRatio", leftRatio);
                obj.put("topRatio", topRatio);
                obj.put("widthRatio", widthRatio);
                obj.put("heightRatio", heightRatio);
            } catch (JSONException ignored) {
            }
            return obj;
        }
    }

    /**
     * Ranges HSV por site:
     * H em [0..360), S em [0..1], V em [0..1].
     * Vermelho cobre dois intervalos ao redor de 0°: [0..redHueLowMax] e [redHueHighMin..360].
     */
    public static class HsvColorProfile {
        public final String siteKey;
        public float greenHueMin = 82f;
        public float greenHueMax = 165f;
        public float greenMinSat = 0.28f;
        public float greenMinVal = 0.20f;

        public float redHueLowMax = 26f;
        public float redHueHighMin = 332f;
        public float redMinSat = 0.32f;
        public float redMinVal = 0.22f;

        public float blackMaxSat = 0.36f;
        public float blackMaxVal = 0.42f;

        // Bac Bo & Aviator HSV
        public float blueHueMin = 188f;
        public float blueHueMax = 252f;
        public float blueMinSat = 0.26f;
        public float blueMinVal = 0.20f;

        public float goldHueMin = 24f;
        public float goldHueMax = 62f;
        public float goldMinSat = 0.28f;
        public float goldMinVal = 0.26f;

        public float purpleHueMin = 255f;
        public float purpleHueMax = 328f;
        public float purpleMinSat = 0.24f;
        public float purpleMinVal = 0.24f;

        public int calibratedSamplesCount = 0;

        public HsvColorProfile(String siteKey) {
            this.siteKey = normalizeSite(siteKey);
        }

        public JSONObject toJson() {
            JSONObject obj = new JSONObject();
            try {
                obj.put("siteKey", siteKey);
                obj.put("greenHueMin", greenHueMin);
                obj.put("greenHueMax", greenHueMax);
                obj.put("greenMinSat", greenMinSat);
                obj.put("greenMinVal", greenMinVal);
                obj.put("redHueLowMax", redHueLowMax);
                obj.put("redHueHighMin", redHueHighMin);
                obj.put("redMinSat", redMinSat);
                obj.put("redMinVal", redMinVal);
                obj.put("blackMaxSat", blackMaxSat);
                obj.put("blackMaxVal", blackMaxVal);
                obj.put("blueHueMin", blueHueMin);
                obj.put("blueHueMax", blueHueMax);
                obj.put("blueMinSat", blueMinSat);
                obj.put("blueMinVal", blueMinVal);
                obj.put("goldHueMin", goldHueMin);
                obj.put("goldHueMax", goldHueMax);
                obj.put("goldMinSat", goldMinSat);
                obj.put("goldMinVal", goldMinVal);
                obj.put("calibratedSamplesCount", calibratedSamplesCount);
            } catch (JSONException ignored) {
            }
            return obj;
        }

        public static HsvColorProfile fromJson(String siteKey, String rawJson) {
            HsvColorProfile p = defaultForSite(siteKey);
            if (rawJson == null || rawJson.isEmpty()) return p;
            try {
                JSONObject obj = new JSONObject(rawJson);
                p.greenHueMin = (float) obj.optDouble("greenHueMin", p.greenHueMin);
                p.greenHueMax = (float) obj.optDouble("greenHueMax", p.greenHueMax);
                p.greenMinSat = (float) obj.optDouble("greenMinSat", p.greenMinSat);
                p.greenMinVal = (float) obj.optDouble("greenMinVal", p.greenMinVal);
                p.redHueLowMax = (float) obj.optDouble("redHueLowMax", p.redHueLowMax);
                p.redHueHighMin = (float) obj.optDouble("redHueHighMin", p.redHueHighMin);
                p.redMinSat = (float) obj.optDouble("redMinSat", p.redMinSat);
                p.redMinVal = (float) obj.optDouble("redMinVal", p.redMinVal);
                p.blackMaxSat = (float) obj.optDouble("blackMaxSat", p.blackMaxSat);
                p.blackMaxVal = (float) obj.optDouble("blackMaxVal", p.blackMaxVal);
                p.blueHueMin = (float) obj.optDouble("blueHueMin", p.blueHueMin);
                p.blueHueMax = (float) obj.optDouble("blueHueMax", p.blueHueMax);
                p.blueMinSat = (float) obj.optDouble("blueMinSat", p.blueMinSat);
                p.blueMinVal = (float) obj.optDouble("blueMinVal", p.blueMinVal);
                p.goldHueMin = (float) obj.optDouble("goldHueMin", p.goldHueMin);
                p.goldHueMax = (float) obj.optDouble("goldHueMax", p.goldHueMax);
                p.goldMinSat = (float) obj.optDouble("goldMinSat", p.goldMinSat);
                p.goldMinVal = (float) obj.optDouble("goldMinVal", p.goldMinVal);
                p.calibratedSamplesCount = obj.optInt("calibratedSamplesCount", p.calibratedSamplesCount);
            } catch (JSONException ignored) {
            }
            return p;
        }

        public static HsvColorProfile defaultForSite(String siteKey) {
            String normalized = normalizeSite(siteKey);
            HsvColorProfile p = new HsvColorProfile(normalized);
            if ("creedroomz".equals(normalized) || "kwanzabet".equals(normalized)) {
                p.redHueLowMax = 24f;
                p.redHueHighMin = 334f;
                p.redMinSat = 0.34f;
                p.greenHueMin = 85f;
                p.greenHueMax = 160f;
            } else if ("evolution".equals(normalized)) {
                p.redHueLowMax = 22f;
                p.redHueHighMin = 336f;
                p.greenHueMin = 90f;
                p.greenHueMax = 162f;
            }
            return p;
        }
    }

    public static class HsvSample {
        public final String label; // "RED", "GREEN", "BLACK", "P", "B", "T"
        public final float hue;
        public final float sat;
        public final float val;

        public HsvSample(String label, float hue, float sat, float val) {
            this.label = label;
            this.hue = hue;
            this.sat = sat;
            this.val = val;
        }

        public static HsvSample fromRgb(String label, int r, int g, int b) {
            float[] hsv = new float[3];
            Color.RGBToHSV(r, g, b, hsv);
            return new HsvSample(label, hsv[0], hsv[1], hsv[2]);
        }
    }

    private final SharedPreferences prefs;

    public RoiConfigStore(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    public static String normalizeSite(String site) {
        if (site == null) return "kwanzabet";
        String cleaned = site.trim().toLowerCase(Locale.US).replaceAll("[^a-z0-9_.-]", "");
        return cleaned.isEmpty() ? "kwanzabet" : cleaned;
    }

    public static String normalizeGame(String game) {
        if (GAME_BACBO.equals(game)) return GAME_BACBO;
        if (GAME_AVIATOR.equals(game)) return GAME_AVIATOR;
        return GAME_ROULETTE;
    }

    public static String normalizeSurface(String surface) {
        if (surface == null) return SURFACE_SPLIT;
        String clean = surface.trim().toLowerCase(Locale.US);
        if (SURFACE_PROJECTION.equals(clean) || "fullscreen".equals(clean) || "media_projection".equals(clean)) {
            return SURFACE_PROJECTION;
        }
        return SURFACE_SPLIT;
    }

    public String getActiveSite() {
        return normalizeSite(prefs.getString("active_site", "kwanzabet"));
    }

    public void setActiveSite(String site) {
        prefs.edit().putString("active_site", normalizeSite(site)).apply();
    }

    public boolean isRouletteNewestOnLeft(String site) {
        String s = normalizeSite(site);
        return prefs.getBoolean("roulette_newest_left_" + s, true);
    }

    public void setRouletteNewestOnLeft(String site, boolean newestOnLeft) {
        String s = normalizeSite(site);
        prefs.edit().putBoolean("roulette_newest_left_" + s, newestOnLeft).apply();
    }

    public boolean isRouletteMultiplierMode(String site) {
        String s = normalizeSite(site);
        return prefs.getBoolean("roulette_multiplier_mode_" + s, false);
    }

    public void setRouletteMultiplierMode(String site, boolean multiplierMode) {
        String s = normalizeSite(site);
        prefs.edit().putBoolean("roulette_multiplier_mode_" + s, multiplierMode).apply();
    }

    public String getBacBoScanMode() {
        String mode = prefs.getString("bacbo_scan_mode", BACBO_MODE_AUTO);
        if (BACBO_MODE_BLOCKS.equals(mode) || BACBO_MODE_BEAD_PLATE.equals(mode)) {
            return mode;
        }
        return BACBO_MODE_AUTO;
    }

    public void setBacBoScanMode(String mode) {
        String resolved = BACBO_MODE_AUTO;
        if (BACBO_MODE_BLOCKS.equals(mode)) resolved = BACBO_MODE_BLOCKS;
        else if (BACBO_MODE_BEAD_PLATE.equals(mode)) resolved = BACBO_MODE_BEAD_PLATE;
        prefs.edit().putString("bacbo_scan_mode", resolved).apply();
    }

    public boolean isDebugOverlayEnabled() {
        return prefs.getBoolean("ocr_debug_overlay", false);
    }

    public void setDebugOverlayEnabled(boolean enabled) {
        prefs.edit().putBoolean("ocr_debug_overlay", enabled).apply();
    }

    public RoiRect getRoiRect(String game, String site) {
        return getRoiRect(game, site, SURFACE_SPLIT);
    }

    public RoiRect getRoiRect(String game, String site, String surface) {
        String g = normalizeGame(game);
        String s = normalizeSite(site);
        String surf = normalizeSurface(surface);

        if (SURFACE_PROJECTION.equals(surf)) {
            String projPrefix = "roi_proj_v2_" + s + "_" + g + "_";
            if (prefs.contains(projPrefix + "top")) {
                return new RoiRect(
                        prefs.getFloat(projPrefix + "left", 0f),
                        prefs.getFloat(projPrefix + "top", 0.14f),
                        prefs.getFloat(projPrefix + "width", 1f),
                        prefs.getFloat(projPrefix + "height", 0.10f)
                );
            }
        }

        String prefix = "roi_v2_" + s + "_" + g + "_";
        if (prefs.contains(prefix + "top")) {
            return new RoiRect(
                    prefs.getFloat(prefix + "left", 0f),
                    prefs.getFloat(prefix + "top", 0.04f),
                    prefs.getFloat(prefix + "width", 1f),
                    prefs.getFloat(prefix + "height", 0.08f)
            );
        }

        // Fallback compatível com as chaves legadas da MainActivity
        if (GAME_BACBO.equals(g)) {
            return new RoiRect(
                    0f,
                    prefs.getFloat("bacbo_blocks_v2_top", 0.34f),
                    1f,
                    prefs.getFloat("bacbo_blocks_v2_height", 0.40f)
            );
        }
        if (GAME_AVIATOR.equals(g)) {
            return new RoiRect(
                    0f,
                    prefs.getFloat("aviator_roi_top", 0.14f),
                    1f,
                    prefs.getFloat("aviator_roi_height", 0.34f)
            );
        }
        return new RoiRect(
                0f,
                prefs.getFloat("roi_top", 0.04f),
                1f,
                prefs.getFloat("roi_height", 0.08f)
        );
    }

    public void saveRoiRect(String game, String site, RoiRect rect) {
        saveRoiRect(game, site, SURFACE_SPLIT, rect);
    }

    public void saveRoiRect(String game, String site, String surface, RoiRect rect) {
        String g = normalizeGame(game);
        String s = normalizeSite(site);
        String surf = normalizeSurface(surface);

        if (SURFACE_PROJECTION.equals(surf)) {
            String projPrefix = "roi_proj_v2_" + s + "_" + g + "_";
            prefs.edit()
                    .putFloat(projPrefix + "left", rect.leftRatio)
                    .putFloat(projPrefix + "top", rect.topRatio)
                    .putFloat(projPrefix + "width", rect.widthRatio)
                    .putFloat(projPrefix + "height", rect.heightRatio)
                    .apply();
            return;
        }

        String prefix = "roi_v2_" + s + "_" + g + "_";
        SharedPreferences.Editor ed = prefs.edit()
                .putFloat(prefix + "left", rect.leftRatio)
                .putFloat(prefix + "top", rect.topRatio)
                .putFloat(prefix + "width", rect.widthRatio)
                .putFloat(prefix + "height", rect.heightRatio);

        // Mantém chaves legadas sincronizadas para retrocompatibilidade no modo Split
        if (GAME_BACBO.equals(g)) {
            ed.putFloat("bacbo_blocks_v2_top", rect.topRatio)
              .putFloat("bacbo_blocks_v2_height", rect.heightRatio);
        } else if (GAME_AVIATOR.equals(g)) {
            ed.putFloat("aviator_roi_top", rect.topRatio)
              .putFloat("aviator_roi_height", rect.heightRatio);
        } else {
            ed.putFloat("roi_top", rect.topRatio)
              .putFloat("roi_height", rect.heightRatio);
        }
        ed.apply();
    }

    public HsvColorProfile getHsvProfile(String site) {
        String s = normalizeSite(site);
        String raw = prefs.getString("hsv_profile_" + s, "");
        return HsvColorProfile.fromJson(s, raw);
    }

    public void saveHsvProfile(HsvColorProfile profile) {
        prefs.edit()
                .putString("hsv_profile_" + profile.siteKey, profile.toJson().toString())
                .apply();
    }

    public void resetHsvProfile(String site) {
        String s = normalizeSite(site);
        prefs.edit().remove("hsv_profile_" + s).apply();
    }

    /**
     * Calibra ranges H/S/V do perfil do site a partir de amostras reais rotuladas (8–12 giros).
     */
    public HsvColorProfile calibrateFromSamples(String site, List<HsvSample> samples) {
        HsvColorProfile profile = getHsvProfile(site);
        if (samples == null || samples.isEmpty()) return profile;

        float gMinH = 360f, gMaxH = 0f, gMinS = 1f, gMinV = 1f;
        int gCount = 0;

        float rLowMax = 0f, rHighMin = 360f, rMinS = 1f, rMinV = 1f;
        int rCount = 0;

        float bMinH = 360f, bMaxH = 0f, bMinS = 1f, bMinV = 1f;
        int bCount = 0;

        float tMinH = 360f, tMaxH = 0f, tMinS = 1f, tMinV = 1f;
        int tCount = 0;

        float kMaxS = 0f, kMaxV = 0f;
        int kCount = 0;

        for (HsvSample smp : samples) {
            if (smp == null || smp.label == null) continue;
            String lbl = smp.label.trim().toUpperCase(Locale.US);
            if ("GREEN".equals(lbl)) {
                gCount++;
                gMinH = Math.min(gMinH, smp.hue);
                gMaxH = Math.max(gMaxH, smp.hue);
                gMinS = Math.min(gMinS, smp.sat);
                gMinV = Math.min(gMinV, smp.val);
            } else if ("RED".equals(lbl) || "B".equals(lbl)) {
                rCount++;
                if (smp.hue <= 60f) rLowMax = Math.max(rLowMax, smp.hue);
                if (smp.hue >= 290f) rHighMin = Math.min(rHighMin, smp.hue);
                rMinS = Math.min(rMinS, smp.sat);
                rMinV = Math.min(rMinV, smp.val);
            } else if ("P".equals(lbl) || "BLUE".equals(lbl)) {
                bCount++;
                bMinH = Math.min(bMinH, smp.hue);
                bMaxH = Math.max(bMaxH, smp.hue);
                bMinS = Math.min(bMinS, smp.sat);
                bMinV = Math.min(bMinV, smp.val);
            } else if ("T".equals(lbl) || "GOLD".equals(lbl)) {
                tCount++;
                tMinH = Math.min(tMinH, smp.hue);
                tMaxH = Math.max(tMaxH, smp.hue);
                tMinS = Math.min(tMinS, smp.sat);
                tMinV = Math.min(tMinV, smp.val);
            } else if ("BLACK".equals(lbl)) {
                kCount++;
                kMaxS = Math.max(kMaxS, smp.sat);
                kMaxV = Math.max(kMaxV, smp.val);
            }
        }

        if (gCount > 0) {
            profile.greenHueMin = clamp(gMinH - 12f, 65f, 125f);
            profile.greenHueMax = clamp(gMaxH + 12f, 130f, 178f);
            profile.greenMinSat = clamp(gMinS * 0.72f, 0.16f, 0.55f);
            profile.greenMinVal = clamp(gMinV * 0.72f, 0.12f, 0.50f);
        }
        if (rCount > 0) {
            if (rLowMax > 0f) profile.redHueLowMax = clamp(rLowMax + 8f, 14f, 34f);
            if (rHighMin < 360f) profile.redHueHighMin = clamp(rHighMin - 8f, 320f, 348f);
            profile.redMinSat = clamp(rMinS * 0.72f, 0.18f, 0.60f);
            profile.redMinVal = clamp(rMinV * 0.72f, 0.14f, 0.55f);
        }
        if (bCount > 0) {
            profile.blueHueMin = clamp(bMinH - 14f, 175f, 220f);
            profile.blueHueMax = clamp(bMaxH + 14f, 225f, 265f);
            profile.blueMinSat = clamp(bMinS * 0.72f, 0.16f, 0.55f);
            profile.blueMinVal = clamp(bMinV * 0.72f, 0.14f, 0.50f);
        }
        if (tCount > 0) {
            profile.goldHueMin = clamp(tMinH - 10f, 16f, 45f);
            profile.goldHueMax = clamp(tMaxH + 10f, 45f, 80f);
            profile.goldMinSat = clamp(tMinS * 0.72f, 0.16f, 0.55f);
            profile.goldMinVal = clamp(tMinV * 0.72f, 0.16f, 0.55f);
        }
        if (kCount > 0) {
            profile.blackMaxSat = clamp(kMaxS + 0.10f, 0.22f, 0.50f);
            profile.blackMaxVal = clamp(kMaxV + 0.12f, 0.25f, 0.55f);
        }

        profile.calibratedSamplesCount += samples.size();
        saveHsvProfile(profile);
        return profile;
    }

    public static JSONArray parseSiteListJson() {
        JSONArray arr = new JSONArray();
        arr.put("kwanzabet");
        arr.put("creedroomz");
        arr.put("evolution");
        arr.put("spribe");
        return arr;
    }

    private static float clamp(float val, float min, float max) {
        return Math.max(min, Math.min(max, val));
    }
}
