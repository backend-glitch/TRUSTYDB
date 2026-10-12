TRUSTYDB conflict dataset — validation notes

All 10 CSVs have exactly the same 12 columns and different row counts.
Rows 1–55 share entity IDs across sources to enable direct comparison.
Intentional conflicts are guaranteed:
- Price differs across sources for 3 out of every 4 shared entities.
- Stock differs across sources for 2 out of every 3 shared entities.
- Category differs for many shared entities, but some categories intentionally agree.
- Product name and product title remain consistent for shared entities to provide matching fields.
- Freshness, condition, availability and vendor rating contain source-specific differences.

Row counts:
SOURCE_A 83
SOURCE_B 117
SOURCE_C 64
SOURCE_D 142
SOURCE_E 96
SOURCE_F 129
SOURCE_G 72
SOURCE_H 155
SOURCE_I 108
SOURCE_J 91

Important: Product identity/category values originate from the project's Kaggle-derived product dataset where available.
Price/stock/condition/availability/vendor rating/verification dates are synthetic test values designed to exercise TRUSTYDB conflict detection, not real verified market data.
