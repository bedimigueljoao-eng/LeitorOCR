package ao.kwanzabet.roletavision

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlin.math.max
import kotlin.math.min

data class DetectedPill(
    val number: Int,
    val color: RouletteColor,
    val leftX: Int
)

class ScreenScanner {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)

    /**
     * Recorta a faixa calibrada onde ficam os resultados (ex: 0, 28, 9, 17...),
     * amplia para leitura nitida no ML Kit e valida o digito com a cor do pixel da ficha.
     */
    fun scanHistoryStrip(
        fullBitmap: Bitmap,
        roiTopRatio: Float,
        roiHeightRatio: Float,
        onResult: (List<Int>) -> Unit
    ) {
        val width = fullBitmap.width
        val height = fullBitmap.height
        if (width < 40 || height < 40) {
            onResult(emptyList())
            return
        }

        val topY = (height * roiTopRatio).toInt().coerceIn(0, height - 20)
        val cropH = (height * roiHeightRatio).toInt().coerceIn(20, height - topY)

        val cropped = Bitmap.createBitmap(fullBitmap, 0, topY, width, cropH)
        // Escala 2x para melhorar leitura de numeros pequenos em telas mobile
        val scaled = Bitmap.createScaledBitmap(cropped, cropped.width * 2, cropped.height * 2, true)
        if (scaled != cropped) {
            cropped.recycle()
        }

        val image = InputImage.fromBitmap(scaled, 0)
        recognizer.process(image)
            .addOnSuccessListener { visionText ->
                val detected = mutableListOf<DetectedPill>()
                for (block in visionText.textBlocks) {
                    for (line in block.lines) {
                        for (element in line.elements) {
                            val box = element.boundingBox ?: continue
                            val sampledColor = samplePillBackgroundColor(scaled, box)
                            val parsed = parseRouletteToken(element.text, sampledColor)
                            if (parsed != null) {
                                detected.add(DetectedPill(parsed, sampledColor, box.left))
                            }
                        }
                    }
                }
                scaled.recycle()

                // Ordena da esquerda (mais recente na Creedroomz) para a direita
                val ordered = detected
                    .sortedBy { it.leftX }
                    .map { it.number }
                onResult(ordered)
            }
            .addOnFailureListener {
                scaled.recycle()
                onResult(emptyList())
            }
    }

    private fun parseRouletteToken(rawText: String, color: RouletteColor): Int? {
        val cleaned = rawText.trim()
            .replace("O", "0")
            .replace("o", "0")
            .replace("I", "1")
            .replace("l", "1")
            .filter { it.isDigit() }

        if (cleaned.isEmpty()) {
            // Se a ficha for verde forte e OCR falhou o digito, e o 0
            return if (color == RouletteColor.GREEN) 0 else null
        }

        val num = cleaned.toIntOrNull() ?: return null
        if (num !in 0..36) return null

        // Validacao cruzada pela cor real da ficha europeia
        if (num == 0 && color != RouletteColor.GREEN) return null
        if (num != 0 && color == RouletteColor.GREEN) return 0

        val expectedColor = RouletteEngine.colorOf(num)
        // Rejeita leituras falsas se a cor for claramente oposta
        if (color == RouletteColor.RED && expectedColor != RouletteColor.RED) return null
        if (color == RouletteColor.BLACK && expectedColor != RouletteColor.BLACK) return null

        return num
    }

    private fun samplePillBackgroundColor(bitmap: Bitmap, box: Rect): RouletteColor {
        val sampleX = (box.left - 6).coerceIn(0, bitmap.width - 1)
        val sampleY = ((box.top + box.bottom) / 2).coerceIn(0, bitmap.height - 1)
        val altX = (box.right + 6).coerceIn(0, bitmap.width - 1)

        val p1 = bitmap.getPixel(sampleX, sampleY)
        val p2 = bitmap.getPixel(altX, sampleY)

        val r = (Color.red(p1) + Color.red(p2)) / 2
        val g = (Color.green(p1) + Color.green(p2)) / 2
        val b = (Color.blue(p1) + Color.blue(p2)) / 2

        return when {
            g > r + 24 && g > b + 18 -> RouletteColor.GREEN
            r > g + 35 && r > b + 30 -> RouletteColor.RED
            max(r, max(g, b)) < 115 && min(r, min(g, b)) < 90 -> RouletteColor.BLACK
            else -> RouletteColor.BLACK
        }
    }
}
