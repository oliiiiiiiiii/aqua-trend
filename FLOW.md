# User Input
1. 自然語言描述的地球自然事件 E
2. 時間：事件發生的時間 是一個區間 T
3. 地點：利用像是 webdemo branch 上面的地球選取，或是自然語言挑，然後顯示在地球上 L


# Step 1

運用 AI(SI) preferabally system 1 model like jev but maybe open source, 將 E 變成一堆變數 {v_i}

使用者可以再編輯 {v_i} 用一個類似 checkbox 的東西

# Step 2

按 開始

對於每一個 v_i 跑 analysis 

# Analaysis: 

對於 vi time series, 去算他扣掉 seasonal change + 整體趨勢之後剩下的數值

將這個數值程現在數線上 並把事件發生前後一年給 user, 標記事件發生的時間 with color

# step 3

對於每一個變數的 analysis , 用不同 page 展現，每一個 page 是一個互動式的 analysis tool 頁面

中間是那個數線 ， 讓 user 可以 zoom in zoom out 區間 選取區間 並有一堆 analysis 工具

這個界面應該不要那麼雜亂 但需要有很多功能


# style guide

用 webdemo 的 style, 但是你可以大改他的內容, however component style remains unchange
