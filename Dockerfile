# Usa uma imagem leve do Node.js
FROM node:18-alpine

# Cria a pasta do app dentro do container
WORKDIR /usr/src/app

# Copia o package.json e instala as dependências
COPY package*.json ./
RUN npm install

# Copia o resto dos arquivos do projeto
COPY . .

# Expõe a porta que você usa (geralmente 3000)
EXPOSE 3000

# O comando final será definido no docker-compose
CMD ["npm", "start"]