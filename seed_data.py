import os
from database import init_db, get_or_create_category, create_product, get_categories, get_products, update_settings

def seed_database():
    init_db()
    
    # Comprobar si ya existen productos
    existing_prods = get_products()
    if existing_prods:
        print(f"La base de datos ya contiene {len(existing_prods)} productos.")
        return

    # Categorías y productos extraídos del PDF "BEBIDAS 25 DE MAYO"
    catalog_data = [
        {
            "category": "CERVEZAS",
            "products": [
                {"name": "Quilmes Lata", "presentation": "710ml", "price_minorista": 2531, "price_mayorista": 1950},
                {"name": "Quilmes", "presentation": "473ml", "price_minorista": 2016, "price_mayorista": 1550},
                {"name": "Quilmes Stout", "presentation": "473ml", "price_minorista": 2118, "price_mayorista": 1620},
                {"name": "Stella Artois", "presentation": "710ml", "price_minorista": 3421, "price_mayorista": 2630},
                {"name": "Stella Artois Botella", "presentation": "710ml", "price_minorista": 4062, "price_mayorista": 3120},
                {"name": "Stella Artois", "presentation": "473ml", "price_minorista": 2451, "price_mayorista": 1880},
                {"name": "Stella Artois Noire Negra", "presentation": "473ml", "price_minorista": 2451, "price_mayorista": 1880},
                {"name": "Schneider", "presentation": "710ml", "price_minorista": 2615, "price_mayorista": 2010},
                {"name": "Schneider", "presentation": "473ml", "price_minorista": 1766, "price_mayorista": 1350},
                {"name": "Warsteiner", "presentation": "473ml", "price_minorista": 2000, "price_mayorista": 1540},
                {"name": "Imperial Golden", "presentation": "710ml", "price_minorista": 3098, "price_mayorista": 2380},
                {"name": "Imperial Golden", "presentation": "473ml", "price_minorista": 2041, "price_mayorista": 1570},
                {"name": "Imperial APA", "presentation": "473ml", "price_minorista": 2249, "price_mayorista": 1730},
                {"name": "Imperial Lager", "presentation": "710ml", "price_minorista": 2822, "price_mayorista": 2170},
                {"name": "Imperial Lager", "presentation": "473ml", "price_minorista": 1904, "price_mayorista": 1460},
                {"name": "Imperial Roja", "presentation": "473ml", "price_minorista": 2249, "price_mayorista": 1730},
                {"name": "Imperial Cream Stout", "presentation": "473ml", "price_minorista": 2249, "price_mayorista": 1730},
                {"name": "Isenbeck", "presentation": "473ml", "price_minorista": 1394, "price_mayorista": 1070},
                {"name": "Michelob Ultra", "presentation": "473ml", "price_minorista": 1562, "price_mayorista": 1200},
                {"name": "Miller", "presentation": "473ml", "price_minorista": 1980, "price_mayorista": 1520},
                {"name": "Miller", "presentation": "710ml", "price_minorista": 3526, "price_mayorista": 2710},
                {"name": "Patagonia", "presentation": "473ml", "price_minorista": 2625, "price_mayorista": 2020},
                {"name": "Patagonia Amber Lager", "presentation": "710ml", "price_minorista": 4594, "price_mayorista": 3530},
                {"name": "Patagonia 24.7 IPA", "presentation": "710ml", "price_minorista": 4594, "price_mayorista": 3530},
                {"name": "Patagonia Lager del Sur", "presentation": "710ml", "price_minorista": 4506, "price_mayorista": 3460},
                {"name": "Grolsch", "presentation": "473ml", "price_minorista": 2000, "price_mayorista": 1540},
                {"name": "Brahma Lata", "presentation": "357ml", "price_minorista": 940, "price_mayorista": 720},
                {"name": "Corona", "presentation": "473ml", "price_minorista": 2406, "price_mayorista": 1850},
                {"name": "Heineken", "presentation": "473ml", "price_minorista": 2588, "price_mayorista": 1990},
                {"name": "Heineken", "presentation": "710ml", "price_minorista": 4425, "price_mayorista": 3400},
                {"name": "Budweiser Porrón", "presentation": "330ml", "price_minorista": 1432, "price_mayorista": 1100},
                {"name": "Peñón del Águila Kolsch", "presentation": "473ml", "price_minorista": 1476, "price_mayorista": 1135},
                {"name": "Peñón del Águila Oktoberfest", "presentation": "473ml", "price_minorista": 1224, "price_mayorista": 940},
                {"name": "Peñón del Águila Waldbier", "presentation": "473ml", "price_minorista": 1562, "price_mayorista": 1200}
            ]
        },
        {
            "category": "TRAGOS LISTOS (RTD)",
            "products": [
                {"name": "Dr. Lemon Red Berries", "presentation": "473ml", "price_minorista": 2164, "price_mayorista": 1660},
                {"name": "Dr. Lemon Green Apple", "presentation": "473ml", "price_minorista": 2164, "price_mayorista": 1660},
                {"name": "Dr. Lemon Limón", "presentation": "473ml", "price_minorista": 2058, "price_mayorista": 1580},
                {"name": "Dr. Lemon Mojito", "presentation": "473ml", "price_minorista": 2058, "price_mayorista": 1580},
                {"name": "Dr. Lemon Botella Red Berry", "presentation": "1L", "price_minorista": 3594, "price_mayorista": 2760},
                {"name": "Dr. Lemon Botella Mojito", "presentation": "1L", "price_minorista": 3594, "price_mayorista": 2760},
                {"name": "Dr. Lemon Botella Pomelo", "presentation": "1L", "price_minorista": 3594, "price_mayorista": 2760},
                {"name": "Smirnoff Ice Red Berries Lata", "presentation": "473ml", "price_minorista": 2875, "price_mayorista": 2210}
            ]
        },
        {
            "category": "FERNET Y AMARGOS",
            "products": [
                {"name": "Fernet 1882", "presentation": "750ml", "price_minorista": 7530, "price_mayorista": 5790},
                {"name": "Fernet 1882 Lata", "presentation": "473ml", "price_minorista": 1539, "price_mayorista": 1180},
                {"name": "Fernet Buhero Negro", "presentation": "750ml", "price_minorista": 6975, "price_mayorista": 5360},
                {"name": "Fernet Branca", "presentation": "750ml", "price_minorista": 16508, "price_mayorista": 12690}
            ]
        },
        {
            "category": "RONES",
            "products": [
                {"name": "Bacardi Blanco", "presentation": "750ml", "price_minorista": 14030, "price_mayorista": 10790},
                {"name": "Bacardi Oro", "presentation": "750ml", "price_minorista": 14030, "price_mayorista": 10790},
                {"name": "Bacardi Blanco", "presentation": "1L", "price_minorista": 18834, "price_mayorista": 14480},
                {"name": "Bacardi Oro", "presentation": "1L", "price_minorista": 18834, "price_mayorista": 14480},
                {"name": "Havana Club Blanco", "presentation": "750ml", "price_minorista": 12555, "price_mayorista": 9650},
                {"name": "Malibu", "presentation": "750ml", "price_minorista": 12904, "price_mayorista": 9920}
            ]
        },
        {
            "category": "WHISKIES",
            "products": [
                {"name": "Johnnie Walker Black Label", "presentation": "1L", "price_minorista": 52812, "price_mayorista": 40600},
                {"name": "Old Smuggler", "presentation": "750ml", "price_minorista": 8579, "price_mayorista": 6590},
                {"name": "Jack Daniel's", "presentation": "1L", "price_minorista": 44846, "price_mayorista": 34490},
                {"name": "Jack Daniel's Honey", "presentation": "1L", "price_minorista": 44846, "price_mayorista": 34490},
                {"name": "Johnnie Walker Red Label", "presentation": "1L", "price_minorista": 29225, "price_mayorista": 22480}
            ]
        },
        {
            "category": "VODKAS",
            "products": [
                {"name": "Smirnoff Raspberry", "presentation": "700ml", "price_minorista": 9165, "price_mayorista": 7050},
                {"name": "Smirnoff Green Apple", "presentation": "700ml", "price_minorista": 9165, "price_mayorista": 7050},
                {"name": "Skyy Pineapple", "presentation": "700ml", "price_minorista": 9501, "price_mayorista": 7300},
                {"name": "Skyy Raspberry", "presentation": "700ml", "price_minorista": 9402, "price_mayorista": 7230},
                {"name": "Absolut Vainilla", "presentation": "750ml", "price_minorista": 21901, "price_mayorista": 16840},
                {"name": "Absolut Apeach", "presentation": "750ml", "price_minorista": 21901, "price_mayorista": 16840}
            ]
        },
        {
            "category": "GINEBRAS Y GIN",
            "products": [
                {"name": "Aconcagua Azul", "presentation": "750ml", "price_minorista": 12762, "price_mayorista": 9810},
                {"name": "Aconcagua Rosa", "presentation": "750ml", "price_minorista": 14339, "price_mayorista": 11030},
                {"name": "Aconcagua Blanco", "presentation": "750ml", "price_minorista": 14339, "price_mayorista": 11030},
                {"name": "Aconcagua Dorado", "presentation": "750ml", "price_minorista": 13834, "price_mayorista": 10640},
                {"name": "Beefeater", "presentation": "750ml", "price_minorista": 18832, "price_mayorista": 14480},
                {"name": "Beefeater Blackberry", "presentation": "750ml", "price_minorista": 22320, "price_mayorista": 17160},
                {"name": "Beefeater Blood Orange", "presentation": "750ml", "price_minorista": 22320, "price_mayorista": 17160},
                {"name": "Heredero Grapefruit", "presentation": "700ml", "price_minorista": 12349, "price_mayorista": 9490},
                {"name": "Heredero Lemon y Ginger", "presentation": "700ml", "price_minorista": 12349, "price_mayorista": 9490}
            ]
        },
        {
            "category": "TEQUILA",
            "products": [
                {"name": "Jose Cuervo Oro", "presentation": "750ml", "price_minorista": 28336, "price_mayorista": 21790}
            ]
        },
        {
            "category": "VINOS",
            "products": [
                {"name": "Trumpeter Malbec", "presentation": "750ml", "price_minorista": 8062, "price_mayorista": 6200},
                {"name": "Trumpeter Chardonnay", "presentation": "750ml", "price_minorista": 8062, "price_mayorista": 6200},
                {"name": "Saint Felicien Cabernet Franc", "presentation": "750ml", "price_minorista": 8930, "price_mayorista": 6860},
                {"name": "Sexy Fish Malbec", "presentation": "750ml", "price_minorista": 4101, "price_mayorista": 3150},
                {"name": "Alma Mora Selección Reserva Cabernet Sauvignon", "presentation": "750ml", "price_minorista": 6150, "price_mayorista": 4730},
                {"name": "Alma Mora Blend Blanc", "presentation": "750ml", "price_minorista": 5544, "price_mayorista": 4260},
                {"name": "Alambrado Malbec", "presentation": "750ml", "price_minorista": 7386, "price_mayorista": 5680}
            ]
        },
        {
            "category": "ESPUMANTES Y CHAMPAGNE",
            "products": [
                {"name": "Federico de Alvear Dulce", "presentation": "750ml", "price_minorista": 4222, "price_mayorista": 3240},
                {"name": "Federico de Alvear Extra Dulce", "presentation": "750ml", "price_minorista": 4222, "price_mayorista": 3240},
                {"name": "Federico de Alvear Extra Brut", "presentation": "750ml", "price_minorista": 4222, "price_mayorista": 3240},
                {"name": "Escorihuela Gascón Extra Brut Rosé", "presentation": "750ml", "price_minorista": 10260, "price_mayorista": 7890},
                {"name": "Escorihuela Gascón Extra Brut", "presentation": "750ml", "price_minorista": 8125, "price_mayorista": 6250},
                {"name": "Cordero con Piel de Lobo Extra Brut", "presentation": "750ml", "price_minorista": 6581, "price_mayorista": 5060},
                {"name": "Cordero con Piel de Lobo Dulce", "presentation": "750ml", "price_minorista": 4748, "price_mayorista": 3650}
            ]
        },
        {
            "category": "GASEOSAS Y ENERGIZANTES",
            "products": [
                {"name": "Gaseosa Manaos Citrus", "presentation": "2,25l x 6u", "price_minorista": 1880, "price_mayorista": 1447, "wholesale_tier1_price": 1404, "wholesale_tier2_price": 1375},
                {"name": "Gaseosa Manaos Cola", "presentation": "2,25l x 6u", "price_minorista": 1880, "price_mayorista": 1447, "wholesale_tier1_price": 1404, "wholesale_tier2_price": 1375},
                {"name": "Gaseosa Manaos Cola", "presentation": "600ml x 12u", "price_minorista": 780, "price_mayorista": 600, "wholesale_tier1_price": 570, "wholesale_tier2_price": 558},
                {"name": "Gaseosa Manaos Lima", "presentation": "600ml x 12u", "price_minorista": 780, "price_mayorista": 600, "wholesale_tier1_price": 570, "wholesale_tier2_price": 558},
                {"name": "Gaseosa Manaos Sin Azucar Tonica", "presentation": "2,25l x 6u", "price_minorista": 1810, "price_mayorista": 1398, "wholesale_tier1_price": 1356, "wholesale_tier2_price": 1328},
                {"name": "Gaseosa Coca Cola Zero", "presentation": "2,25l x 8u", "price_minorista": 4900, "price_mayorista": 3780, "wholesale_tier1_price": 3742, "wholesale_tier2_price": 3704},
                {"name": "Coca Cola", "presentation": "2.25L", "price_minorista": 4765, "price_mayorista": 3660},
                {"name": "Speed Unlimited", "presentation": "500ml", "price_minorista": 2225, "price_mayorista": 1710}
            ]
        }
    ]

    total_inserted = 0
    for cat_idx, group in enumerate(catalog_data):
        cat_name = group["category"]
        cat_id = get_or_create_category(cat_name)
        
        for prod_idx, prod in enumerate(group["products"]):
            p_may = prod.get("price_mayorista", 0)
            
            create_product({
                "category_id": cat_id,
                "name": prod["name"],
                "presentation": prod.get("presentation", ""),
                "price_minorista": prod["price_minorista"],
                "price_mayorista": p_may,
                "stock": 10,
                "image_path": "",
                "order_index": prod_idx + 1,
                "is_active": 1,
                "is_featured": 1 if prod_idx < 2 else 0
            })
            total_inserted += 1

    print(f"Se inicializaron {len(catalog_data)} categorías y {total_inserted} productos con éxito.")

if __name__ == "__main__":
    seed_database()
