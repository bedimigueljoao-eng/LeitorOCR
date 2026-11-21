package ao.kwanzabet.roletavision

enum class RouletteColor {
    GREEN, RED, BLACK
}

data class FieldSuggestions(
    val color: String,
    val parity: String,
    val half: String,
    val dozenIndex: Int,
    val dozenLabel: String,
    val columnIndex: Int,
    val columnLabel: String,
    val anchorNumber: Int,
    val neighbors: List<Int>,
    val sectorName: String
)

data class MarketEval(
    val market: String,
    val predicted: String,
    val actual: String,
    val hit: Boolean
)

data class MarketStats(
    val market: String,
    val hits: Int,
    val attempts: Int,
    val ratePct: Double
)

data class AccuracySummary(
    val evaluatedRounds: Int,
    val totalHits: Int,
    val totalAttempts: Int,
    val overallRatePct: Double,
    val levelLabel: String,
    val byMarket: List<MarketStats>,
    val lastRoundEvals: List<MarketEval>,
    val lastActualNumber: Int?
)

data class AnalysisResult(
    val totalSpins: Int,
    val lastNumber: Int?,
    val recommendedAnchor: Int,
    val neighbors: List<Int>,
    val recommendedSector: String,
    val sectorNumbers: List<Int>,
    val recommendedDozen: String,
    val dozenDelay: Int,
    val recommendedColumn: String,
    val columnDelay: Int,
    val hotNumbers: List<Int>,
    val coldNumbers: List<Int>,
    val learnedFollowups: List<Int>,
    val coveragePct: Double,
    val suggestedUnitAoa: Int,
    val fieldSuggestions: FieldSuggestions,
    val accuracy: AccuracySummary
)

object RouletteEngine {

    val WHEEL_ORDER = listOf(
        0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
        5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
    )

    val RED_NUMBERS = setOf(
        1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36
    )

    val VOISINS = setOf(22, 18, 29, 7, 28, 12, 35, 3, 26, 0, 32, 15, 19, 4, 21, 2, 25)
    val TIERS = setOf(27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33)
    val ORPHELINS = setOf(1, 20, 14, 31, 9, 17, 34, 6)

    fun colorOf(number: Int): RouletteColor {
        return when {
            number == 0 -> RouletteColor.GREEN
            RED_NUMBERS.contains(number) -> RouletteColor.RED
            else -> RouletteColor.BLACK
        }
    }

    fun dozenOf(number: Int): Int {
        return when {
            number == 0 -> 0
            number <= 12 -> 1
            number <= 24 -> 2
            else -> 3
        }
    }

    fun columnOf(number: Int): Int {
        if (number == 0) return 0
        return ((number - 1) % 3) + 1
    }

    fun wheelNeighbors(anchor: Int, radius: Int = 2): List<Int> {
        val idx = WHEEL_ORDER.indexOf(anchor)
        if (idx == -1) return listOf(anchor)
        val result = mutableListOf<Int>()
        for (offset in -radius..radius) {
            val pos = ((idx + offset) % WHEEL_ORDER.size + WHEEL_ORDER.size) % WHEEL_ORDER.size
            result.add(WHEEL_ORDER[pos])
        }
        return result
    }

    fun computeFieldSuggestions(spinsNewestFirst: List<Int>): FieldSuggestions {
        if (spinsNewestFirst.isEmpty()) {
            return FieldSuggestions(
                color = "Vermelho",
                parity = "Par",
                half = "1-18 (Baixo)",
                dozenIndex = 2,
                dozenLabel = "2a Duzia (13-24)",
                columnIndex = 2,
                columnLabel = "Coluna 2",
                anchorNumber = 0,
                neighbors = wheelNeighbors(0, 2),
                sectorName = "Voisins du Zero"
            )
        }

        val last = spinsNewestFirst.first()
        val transitionCounts = IntArray(37)
        for (i in 1 until spinsNewestFirst.size) {
            val prevSpin = spinsNewestFirst[i]
            val nextSpin = spinsNewestFirst[i - 1]
            if (prevSpin == last && nextSpin in 0..36) {
                transitionCounts[nextSpin]++
            }
        }

        val recentWindow = spinsNewestFirst.take(20)
        val numberScores = DoubleArray(37)
        recentWindow.forEachIndexed { idx, num ->
            val recencyWeight = (recentWindow.size - idx) / recentWindow.size.toDouble()
            numberScores[num] += 1.2 * recencyWeight
            for (nb in wheelNeighbors(num, 1)) {
                numberScores[nb] += 0.35 * recencyWeight
            }
        }
        for (n in 0..36) {
            numberScores[n] += transitionCounts[n] * 1.6
        }

        val anchor = (0..36).maxByOrNull { numberScores[it] } ?: last
        val neighbors = wheelNeighbors(anchor, 2)

        val sectorName = listOf(
            "Voisins du Zero" to recentWindow.count { VOISINS.contains(it) } / 17.0,
            "Tiers du Cylindre" to recentWindow.count { TIERS.contains(it) } / 12.0,
            "Orphelins" to recentWindow.count { ORPHELINS.contains(it) } / 8.0
        ).maxByOrNull { it.second }!!.first

        // Duzia com maior atraso
        val bestDozen = (1..3).maxByOrNull { dz ->
            val idx = spinsNewestFirst.indexOfFirst { dozenOf(it) == dz }
            if (idx == -1) spinsNewestFirst.size else idx
        } ?: 2
        val dozenLabel = when (bestDozen) {
            1 -> "1a Duzia (1-12)"
            2 -> "2a Duzia (13-24)"
            else -> "3a Duzia (25-36)"
        }

        // Coluna com maior atraso
        val bestCol = (1..3).maxByOrNull { col ->
            val idx = spinsNewestFirst.indexOfFirst { columnOf(it) == col }
            if (idx == -1) spinsNewestFirst.size else idx
        } ?: 2
        val colLabel = "Coluna $bestCol"

        // Cor (Vermelho vs Preto)
        val recent12 = spinsNewestFirst.take(12)
        val red12 = recent12.count { colorOf(it) == RouletteColor.RED }
        val black12 = recent12.count { colorOf(it) == RouletteColor.BLACK }
        var redStreak = 0
        var blackStreak = 0
        for (n in spinsNewestFirst) {
            val c = colorOf(n)
            if (c == RouletteColor.RED && blackStreak == 0) redStreak++
            else if (c == RouletteColor.BLACK && redStreak == 0) blackStreak++
            else break
        }
        val colorSuggestion = when {
            redStreak >= 3 -> "Preto"
            blackStreak >= 3 -> "Vermelho"
            red12 <= black12 -> "Vermelho"
            else -> "Preto"
        }

        // Paridade (Par vs Impar)
        val even12 = recent12.count { it != 0 && it % 2 == 0 }
        val odd12 = recent12.count { it != 0 && it % 2 == 1 }
        var evenStreak = 0
        var oddStreak = 0
        for (n in spinsNewestFirst) {
            if (n == 0) break
            if (n % 2 == 0 && oddStreak == 0) evenStreak++
            else if (n % 2 == 1 && evenStreak == 0) oddStreak++
            else break
        }
        val paritySuggestion = when {
            evenStreak >= 3 -> "Impar"
            oddStreak >= 3 -> "Par"
            even12 <= odd12 -> "Par"
            else -> "Impar"
        }

        // Forca / Metade (1-18 vs 19-36)
        val low12 = recent12.count { it in 1..18 }
        val high12 = recent12.count { it in 19..36 }
        val halfSuggestion = if (low12 <= high12) "1-18 (Baixo)" else "19-36 (Alto)"

        return FieldSuggestions(
            color = colorSuggestion,
            parity = paritySuggestion,
            half = halfSuggestion,
            dozenIndex = bestDozen,
            dozenLabel = dozenLabel,
            columnIndex = bestCol,
            columnLabel = colLabel,
            anchorNumber = anchor,
            neighbors = neighbors,
            sectorName = sectorName
        )
    }

    fun evaluateAccuracy(spinsNewestFirst: List<Int>): AccuracySummary {
        val marketNames = listOf(
            "Verm/Preto",
            "Par/Impar",
            "1-18/19-36",
            "Duzia",
            "Coluna",
            "Vizinhos"
        )
        if (spinsNewestFirst.size < 2) {
            return AccuracySummary(
                evaluatedRounds = 0,
                totalHits = 0,
                totalAttempts = 0,
                overallRatePct = 0.0,
                levelLabel = "Aguardando mais giros",
                byMarket = marketNames.map { MarketStats(it, 0, 0, 0.0) },
                lastRoundEvals = emptyList(),
                lastActualNumber = spinsNewestFirst.firstOrNull()
            )
        }

        val chronological = spinsNewestFirst.reversed()
        val hits = IntArray(6)
        val attempts = IntArray(6)
        var lastRoundEvals = emptyList<MarketEval>()
        var lastActual = chronological.last()

        for (i in 1 until chronological.size) {
            val priorNewestFirst = chronological.subList(0, i).reversed()
            val sug = computeFieldSuggestions(priorNewestFirst)
            val actual = chronological[i]
            val actualColor = colorOf(actual)

            val colorActual = when (actualColor) {
                RouletteColor.GREEN -> "Zero (0)"
                RouletteColor.RED -> "Vermelho"
                RouletteColor.BLACK -> "Preto"
            }
            val colorHit = (sug.color == "Vermelho" && actualColor == RouletteColor.RED) ||
                (sug.color == "Preto" && actualColor == RouletteColor.BLACK)

            val parityActual = when {
                actual == 0 -> "Zero (0)"
                actual % 2 == 0 -> "Par"
                else -> "Impar"
            }
            val parityHit = actual != 0 && ((sug.parity == "Par" && actual % 2 == 0) ||
                (sug.parity == "Impar" && actual % 2 == 1))

            val halfActual = when {
                actual == 0 -> "Zero (0)"
                actual <= 18 -> "1-18 (Baixo)"
                else -> "19-36 (Alto)"
            }
            val halfHit = actual != 0 && ((sug.half.startsWith("1-18") && actual <= 18) ||
                (sug.half.startsWith("19-36") && actual >= 19))

            val actualDz = dozenOf(actual)
            val dzActual = if (actualDz == 0) "Zero (0)" else "${actualDz}a Duzia"
            val dzHit = actualDz == sug.dozenIndex

            val actualCol = columnOf(actual)
            val colActual = if (actualCol == 0) "Zero (0)" else "Coluna $actualCol"
            val colHit = actualCol == sug.columnIndex

            val nbHit = sug.neighbors.contains(actual)

            val roundEvals = listOf(
                MarketEval("Verm/Preto", sug.color, colorActual, colorHit),
                MarketEval("Par/Impar", sug.parity, parityActual, parityHit),
                MarketEval("1-18/19-36", sug.half, halfActual, halfHit),
                MarketEval("Duzia", sug.dozenLabel, dzActual, dzHit),
                MarketEval("Coluna", sug.columnLabel, colActual, colHit),
                MarketEval("Vizinhos", sug.neighbors.joinToString(","), actual.toString(), nbHit)
            )

            roundEvals.forEachIndexed { idx, ev ->
                attempts[idx]++
                if (ev.hit) hits[idx]++
            }
            lastRoundEvals = roundEvals
            lastActual = actual
        }

        val totalHits = hits.sum()
        val totalAttempts = attempts.sum()
        val overallPct = if (totalAttempts > 0) (totalHits * 100.0) / totalAttempts else 0.0
        val rounds = chronological.size - 1

        val levelLabel = when {
            rounds < 3 -> "Em Calibracao"
            overallPct >= 48.0 -> "Nivel Alto"
            overallPct >= 36.0 -> "Nivel Equilibrado"
            else -> "Nivel Baixo"
        }

        val byMarket = marketNames.mapIndexed { idx, name ->
            val pct = if (attempts[idx] > 0) (hits[idx] * 100.0) / attempts[idx] else 0.0
            MarketStats(name, hits[idx], attempts[idx], pct)
        }

        return AccuracySummary(
            evaluatedRounds = rounds,
            totalHits = totalHits,
            totalAttempts = totalAttempts,
            overallRatePct = overallPct,
            levelLabel = levelLabel,
            byMarket = byMarket,
            lastRoundEvals = lastRoundEvals,
            lastActualNumber = lastActual
        )
    }

    /**
     * Analisa a lista de resultados onde index 0 e o mais RECENTE.
     */
    fun analyze(spinsNewestFirst: List<Int>, unitAoa: Int = 50): AnalysisResult {
        val suggestions = computeFieldSuggestions(spinsNewestFirst)
        val accuracy = evaluateAccuracy(spinsNewestFirst)

        if (spinsNewestFirst.isEmpty()) {
            return AnalysisResult(
                totalSpins = 0,
                lastNumber = null,
                recommendedAnchor = 0,
                neighbors = suggestions.neighbors,
                recommendedSector = suggestions.sectorName,
                sectorNumbers = VOISINS.toList(),
                recommendedDozen = suggestions.dozenLabel,
                dozenDelay = 0,
                recommendedColumn = suggestions.columnLabel,
                columnDelay = 0,
                hotNumbers = emptyList(),
                coldNumbers = emptyList(),
                learnedFollowups = emptyList(),
                coveragePct = 13.5,
                suggestedUnitAoa = unitAoa,
                fieldSuggestions = suggestions,
                accuracy = accuracy
            )
        }

        val freq = IntArray(37)
        for (n in spinsNewestFirst) {
            if (n in 0..36) freq[n]++
        }

        val last = spinsNewestFirst.first()
        val transitionCounts = IntArray(37)
        for (i in 1 until spinsNewestFirst.size) {
            val prevSpin = spinsNewestFirst[i]
            val nextSpin = spinsNewestFirst[i - 1]
            if (prevSpin == last && nextSpin in 0..36) {
                transitionCounts[nextSpin]++
            }
        }
        val learnedFollowups = (0..36)
            .filter { transitionCounts[it] > 0 }
            .sortedByDescending { transitionCounts[it] }
            .take(4)

        val recentWindow = spinsNewestFirst.take(18)
        val sectorList = when (suggestions.sectorName) {
            "Voisins du Zero" -> VOISINS.toList()
            "Tiers du Cylindre" -> TIERS.toList()
            else -> ORPHELINS.toList()
        }

        val dozenDelay = spinsNewestFirst.indexOfFirst { dozenOf(it) == suggestions.dozenIndex }
            .let { if (it == -1) spinsNewestFirst.size else it }
        val colDelay = spinsNewestFirst.indexOfFirst { columnOf(it) == suggestions.columnIndex }
            .let { if (it == -1) spinsNewestFirst.size else it }

        val hot = (0..36).filter { freq[it] > 0 }.sortedByDescending { freq[it] }.take(5)
        val cold = (0..36).sortedBy { freq[it] }.take(5)

        val uniqueCovered = (suggestions.neighbors + learnedFollowups.take(2)).distinct()
        val coverage = (uniqueCovered.size / 37.0) * 100.0

        return AnalysisResult(
            totalSpins = spinsNewestFirst.size,
            lastNumber = last,
            recommendedAnchor = suggestions.anchorNumber,
            neighbors = suggestions.neighbors,
            recommendedSector = suggestions.sectorName,
            sectorNumbers = sectorList,
            recommendedDozen = suggestions.dozenLabel,
            dozenDelay = dozenDelay,
            recommendedColumn = suggestions.columnLabel,
            columnDelay = colDelay,
            hotNumbers = hot,
            coldNumbers = cold,
            learnedFollowups = learnedFollowups,
            coveragePct = coverage,
            suggestedUnitAoa = unitAoa,
            fieldSuggestions = suggestions,
            accuracy = accuracy
        )
    }
}
