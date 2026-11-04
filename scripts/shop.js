(function () {
  'use strict';

  const products = [
    {
      name: 'Valor Africa Blue Sweatshirt',
      description: 'Bright blue crewneck sweatshirt featuring the Valor Africa emblem.',
      image: '0037AE54-4CD5-47E0-B113-979E1D34E2AF.jpg'
    },
    {
      name: 'Valor Africa Printed Shorts',
      description: 'Teal shorts with a dark Valor Africa logo printed on the leg.',
      image: '07B2D599-BA68-4FE9-B06D-0921EAA342F2.jpg'
    },
    {
      name: 'Valor Africa Cap and Sweatshirt',
      description: 'A dark Valor Africa sweatshirt and pink branded cap, shown together.',
      image: '4B845D28-C5D5-4968-AA08-C57418C5B819.jpg'
    },
    {
      name: 'Valor Africa Blue Tote Bag',
      description: 'Blue carry bag with the Valor Africa emblem and wordmark.',
      image: '52D62502-C0A7-4EDD-AEE3-370A48668A0E.jpg'
    },
    {
      name: 'Valor Africa Pink T-Shirt',
      description: 'Light pink T-shirt featuring the Valor Africa logo on the chest.',
      image: '54F15520-FA4B-4651-9C31-C2C6EECCCE75.jpg'
    },
    {
      name: 'Valor Africa T-Shirt',
      description: 'A white Valor Africa logo T-shirt, shown in a casual outdoor setting.',
      image: '5D006391-F19A-4DB0-970D-69A242182D19.jpg'
    },
    {
      name: 'Valor Africa Emblem Artwork',
      description: 'Gold Valor Africa emblem artwork on a deep blue patterned background.',
      image: '5D6B6CFD-C2A5-4369-9B24-DDE4E6016A1D.jpg'
    },
    {
      name: 'Valor Africa Community T-Shirt',
      description: 'A Valor Africa logo T-shirt worn at an outdoor community gathering.',
      image: '772F7391-0EAD-49FE-8812-4B11449393AD.jpg'
    },
    {
      name: 'Valor Africa Event T-Shirt',
      description: 'A branded black T-shirt worn at a colorful Valor Africa event.',
      image: 'AACDD523-E3D8-4B09-8A3C-438958EC6002.jpg'
    },
    {
      name: 'Valor Africa Yellow Hoodie',
      description: 'Yellow Valor Africa hoodie shown with coordinating branded accessories.',
      image: 'B7B98527-ADA7-4AB4-8ED4-607E6F5ADC49.jpg'
    },
    {
      name: 'Valor Africa Paper Gift Bag',
      description: 'White paper shopping bag with a gold Valor Africa emblem and wordmark.',
      image: 'BE7C77E3-23C9-48EF-AC6C-DBA72F90EC37.jpg'
    },
    {
      name: 'Valor Africa Sweatshirt and Joggers',
      description: 'A matching dark sweatshirt and joggers set with Valor Africa emblems.',
      image: 'IMG_0729.jpg'
    },
    {
      name: 'Valor Africa Gold Emblem Artwork',
      description: 'A glowing gold Valor Africa emblem graphic on a dark background.',
      image: 'IMG_1212.jpg'
    },
    {
      name: 'Valor Africa Lanyards and ID Badges',
      description: 'Branded neck lanyards paired with printed Valor Africa identification badges.',
      image: 'PhotoRoom_20220831_074744.png'
    }
  ];

  const productGrid = document.getElementById('shopProducts');
  products.forEach((product) => {
    const card = document.createElement('article');
    card.className = 'shop-product-card';

    const image = document.createElement('img');
    image.className = 'shop-product-image';
    image.src = `images/Valor%20Shop/${product.image}`;
    image.alt = product.name;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      image.alt = `${product.name} image could not be loaded`;
    }, { once: true });

    const details = document.createElement('div');
    details.className = 'shop-product-details';

    const brand = document.createElement('span');
    brand.className = 'shop-product-brand';
    brand.textContent = 'VALOR AFRICA';

    const name = document.createElement('h3');
    name.textContent = product.name;

    const description = document.createElement('p');
    description.textContent = product.description;

    const inquiry = document.createElement('a');
    inquiry.className = 'shop-product-inquiry';
    inquiry.href = `mailto:hello@valorafrica.co.ke?subject=${encodeURIComponent(`Merchandise enquiry: ${product.name}`)}`;
    inquiry.textContent = 'Ask about this item';

    details.append(brand, name, description, inquiry);
    card.append(image, details);
    productGrid.appendChild(card);
  });
})();
