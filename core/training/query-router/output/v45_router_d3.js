/**
 * CatBoost Query Router - Auto-generated from trained model
 * Trees: 498
 * Classes: 4 (LEXICAL, SEMANTIC, STRUCTURAL, HYBRID)
 * 
 * This is pure JavaScript - no native dependencies required.
 */

const LABELS = ["LEXICAL", "SEMANTIC", "STRUCTURAL", "HYBRID"];

/**
 * Route a query using the CatBoost model.
 * @param {number[]} features - Array of 38 features
 * @returns {{mode: string, confidence: number, scores: number[]}}
 */
function routeQueryCatBoost(features) {
  // Accumulate scores across all trees
  const scores = [0, 0, 0, 0];  // LEXICAL, SEMANTIC, STRUCTURAL, HYBRID

  // Tree 0 (depth=3)
  {
    const leafIdx = ((features[44] > 0.44999998807907104) << 0) | ((features[13] > 0.5192592144012451) << 1) | ((features[34] > 0.3500000238418579) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.087906; scores[1] += -0.073876; scores[2] += -0.086190; scores[3] += 0.247972; break;
      case 1: scores[0] += -0.095295; scores[1] += -0.045491; scores[2] += -0.095295; scores[3] += 0.236081; break;
      case 2: scores[0] += -0.099092; scores[1] += -0.095310; scores[2] += -0.099092; scores[3] += 0.293495; break;
      case 3: scores[0] += -0.095017; scores[1] += -0.090863; scores[2] += -0.095017; scores[3] += 0.280896; break;
      case 4: scores[0] += -0.092805; scores[1] += -0.092805; scores[2] += -0.069416; scores[3] += 0.255027; break;
      case 5: scores[0] += -0.087820; scores[1] += -0.087820; scores[2] += -0.071576; scores[3] += 0.247215; break;
      case 6: scores[0] += -0.068632; scores[1] += -0.068632; scores[2] += -0.068632; scores[3] += 0.205897; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 1 (depth=3)
  {
    const leafIdx = ((features[29] > 0.5) << 0) | ((features[9] > 3.5) << 1) | ((features[5] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.070192; scores[1] += -0.066668; scores[2] += -0.071145; scores[3] += 0.208005; break;
      case 1: scores[0] += -0.075601; scores[1] += -0.027672; scores[2] += -0.075612; scores[3] += 0.178886; break;
      case 2: scores[0] += -0.081073; scores[1] += -0.048673; scores[2] += -0.067981; scores[3] += 0.197726; break;
      case 3: scores[0] += -0.073275; scores[1] += -0.053417; scores[2] += -0.073324; scores[3] += 0.200017; break;
      case 4: scores[0] += 0.082251; scores[1] += -0.025287; scores[2] += -0.025052; scores[3] += -0.031912; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 2 (depth=3)
  {
    const leafIdx = ((features[47] > 0.6833333373069763) << 0) | ((features[32] > 0.5) << 1) | ((features[0] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.066226; scores[1] += -0.035562; scores[2] += -0.068535; scores[3] += 0.170323; break;
      case 1: scores[0] += -0.052307; scores[1] += -0.052392; scores[2] += -0.055690; scores[3] += 0.160389; break;
      case 2: scores[0] += -0.064610; scores[1] += -0.041542; scores[2] += -0.054023; scores[3] += 0.160174; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.051924; scores[1] += -0.070004; scores[2] += -0.049814; scores[3] += 0.171743; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.073248; scores[1] += -0.073588; scores[2] += 0.080571; scores[3] += 0.066266; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 3 (depth=3)
  {
    const leafIdx = ((features[47] > 0.75) << 0) | ((features[13] > 0.43095237016677856) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.020857; scores[1] += -0.054082; scores[2] += -0.071253; scores[3] += 0.104478; break;
      case 1: scores[0] += 0.006294; scores[1] += -0.001719; scores[2] += -0.001694; scores[3] += -0.002881; break;
      case 2: scores[0] += -0.055684; scores[1] += -0.052661; scores[2] += -0.055682; scores[3] += 0.164028; break;
      case 3: scores[0] += -0.036738; scores[1] += -0.032766; scores[2] += -0.036659; scores[3] += 0.106164; break;
      case 4: scores[0] += -0.065911; scores[1] += -0.029131; scores[2] += -0.043255; scores[3] += 0.138297; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.057655; scores[1] += -0.045350; scores[2] += -0.057666; scores[3] += 0.160671; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 4 (depth=3)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[11] > 0.023532669991254807) << 1) | ((features[43] > 0.22792208194732666) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.043937; scores[1] += -0.015730; scores[2] += -0.058785; scores[3] += 0.118452; break;
      case 1: scores[0] += -0.061299; scores[1] += 0.003378; scores[2] += -0.060930; scores[3] += 0.118850; break;
      case 2: scores[0] += 0.005328; scores[1] += -0.060574; scores[2] += -0.061115; scores[3] += 0.116361; break;
      case 3: scores[0] += -0.057247; scores[1] += -0.056080; scores[2] += -0.022985; scores[3] += 0.136313; break;
      case 4: scores[0] += -0.058719; scores[1] += 0.012953; scores[2] += -0.058632; scores[3] += 0.104398; break;
      case 5: scores[0] += -0.050929; scores[1] += -0.042020; scores[2] += -0.050952; scores[3] += 0.143901; break;
      case 6: scores[0] += -0.050993; scores[1] += -0.046713; scores[2] += -0.050692; scores[3] += 0.148398; break;
      case 7: scores[0] += -0.045201; scores[1] += -0.036110; scores[2] += -0.045338; scores[3] += 0.126649; break;
    }
  }

  // Tree 5 (depth=3)
  {
    const leafIdx = ((features[5] > 0.5) << 0) | ((features[47] > 0.550000011920929) << 1) | ((features[10] > 5.0833330154418945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.057560; scores[1] += 0.015913; scores[2] += -0.055685; scores[3] += 0.097332; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.045475; scores[1] += -0.032425; scores[2] += -0.041098; scores[3] += 0.118998; break;
      case 5: scores[0] += 0.071037; scores[1] += -0.018276; scores[2] += -0.017647; scores[3] += -0.035113; break;
      case 6: scores[0] += -0.043564; scores[1] += -0.035962; scores[2] += -0.045338; scores[3] += 0.124864; break;
      case 7: scores[0] += 0.018458; scores[1] += -0.004601; scores[2] += -0.004325; scores[3] += -0.009531; break;
    }
  }

  // Tree 6 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[16] > 0.5) << 1) | ((features[44] > 0.15000000596046448) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000337; scores[1] += -0.044148; scores[2] += -0.056090; scores[3] += 0.099900; break;
      case 1: scores[0] += 0.061590; scores[1] += 0.028319; scores[2] += -0.026329; scores[3] += -0.063579; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.052194; scores[1] += -0.023293; scores[2] += -0.036189; scores[3] += 0.111676; break;
      case 5: scores[0] += -0.065714; scores[1] += 0.242057; scores[2] += -0.066975; scores[3] += -0.109369; break;
      case 6: scores[0] += -0.048403; scores[1] += -0.050137; scores[2] += 0.035366; scores[3] += 0.063173; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 7 (depth=3)
  {
    const leafIdx = ((features[13] > 0.6530100107192993) << 0) | ((features[38] > 0.5) << 1) | ((features[37] > 0.10000000149011612) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.050682; scores[1] += 0.006316; scores[2] += -0.053297; scores[3] += 0.097664; break;
      case 1: scores[0] += -0.040505; scores[1] += -0.039024; scores[2] += -0.040481; scores[3] += 0.120010; break;
      case 2: scores[0] += -0.013725; scores[1] += -0.050186; scores[2] += -0.016485; scores[3] += 0.080396; break;
      case 3: scores[0] += -0.020032; scores[1] += -0.021100; scores[2] += -0.021043; scores[3] += 0.062174; break;
      case 4: scores[0] += -0.045394; scores[1] += -0.027612; scores[2] += -0.033922; scores[3] += 0.106929; break;
      case 5: scores[0] += -0.008141; scores[1] += -0.009185; scores[2] += -0.008637; scores[3] += 0.025963; break;
      case 6: scores[0] += -0.079727; scores[1] += -0.053302; scores[2] += 0.254174; scores[3] += -0.121145; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 8 (depth=3)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[38] > 0.5) << 1) | ((features[1] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.041300; scores[1] += -0.012813; scores[2] += -0.046986; scores[3] += 0.101099; break;
      case 1: scores[0] += -0.047098; scores[1] += -0.007709; scores[2] += -0.045404; scores[3] += 0.100210; break;
      case 2: scores[0] += 0.261185; scores[1] += -0.098334; scores[2] += -0.098141; scores[3] += -0.064709; break;
      case 3: scores[0] += -0.053805; scores[1] += -0.053934; scores[2] += 0.018557; scores[3] += 0.089182; break;
      case 4: scores[0] += -0.011554; scores[1] += 0.054279; scores[2] += -0.009820; scores[3] += -0.032905; break;
      case 5: scores[0] += -0.008178; scores[1] += 0.046393; scores[2] += -0.008436; scores[3] += -0.029779; break;
      case 6: scores[0] += 0.079566; scores[1] += -0.017771; scores[2] += -0.015766; scores[3] += -0.046029; break;
      case 7: scores[0] += -0.052342; scores[1] += 0.200269; scores[2] += -0.054767; scores[3] += -0.093160; break;
    }
  }

  // Tree 9 (depth=3)
  {
    const leafIdx = ((features[43] > 0.0889328122138977) << 0) | ((features[13] > 0.4654761850833893) << 1) | ((features[2] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.041032; scores[1] += -0.008555; scores[2] += -0.018869; scores[3] += 0.068456; break;
      case 1: scores[0] += -0.057772; scores[1] += 0.046713; scores[2] += -0.057463; scores[3] += 0.068522; break;
      case 2: scores[0] += -0.040210; scores[1] += -0.022251; scores[2] += -0.040182; scores[3] += 0.102643; break;
      case 3: scores[0] += -0.037128; scores[1] += -0.031593; scores[2] += -0.037145; scores[3] += 0.105865; break;
      case 4: scores[0] += 0.002686; scores[1] += -0.050249; scores[2] += -0.040672; scores[3] += 0.088236; break;
      case 5: scores[0] += -0.038775; scores[1] += -0.027517; scores[2] += -0.037853; scores[3] += 0.104145; break;
      case 6: scores[0] += -0.034728; scores[1] += -0.035106; scores[2] += -0.034583; scores[3] += 0.104416; break;
      case 7: scores[0] += -0.031426; scores[1] += -0.029822; scores[2] += -0.031201; scores[3] += 0.092449; break;
    }
  }

  // Tree 10 (depth=3)
  {
    const leafIdx = ((features[10] > 9.708333969116211) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 10.291666030883789) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.046113; scores[1] += 0.005321; scores[2] += -0.045817; scores[3] += 0.086609; break;
      case 1: scores[0] += -0.021963; scores[1] += -0.024103; scores[2] += -0.042013; scores[3] += 0.088080; break;
      case 2: scores[0] += -0.060415; scores[1] += -0.042605; scores[2] += 0.039950; scores[3] += 0.063070; break;
      case 3: scores[0] += -0.023679; scores[1] += -0.025569; scores[2] += 0.038937; scores[3] += 0.010311; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += -0.005901; scores[1] += -0.030775; scores[2] += -0.048736; scores[3] += 0.085412; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.060174; scores[1] += -0.063033; scores[2] += 0.147799; scores[3] += -0.024592; break;
    }
  }

  // Tree 11 (depth=3)
  {
    const leafIdx = ((features[11] > 0.14907407760620117) << 0) | ((features[32] > 0.5) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.042967; scores[1] += 0.003324; scores[2] += -0.045488; scores[3] += 0.085130; break;
      case 1: scores[0] += -0.037219; scores[1] += -0.016491; scores[2] += -0.036759; scores[3] += 0.090469; break;
      case 2: scores[0] += -0.041109; scores[1] += -0.016895; scores[2] += -0.023713; scores[3] += 0.081717; break;
      case 3: scores[0] += -0.023813; scores[1] += -0.026958; scores[2] += -0.027809; scores[3] += 0.078581; break;
      case 4: scores[0] += -0.011647; scores[1] += -0.045802; scores[2] += -0.005497; scores[3] += 0.062946; break;
      case 5: scores[0] += 0.145204; scores[1] += -0.046918; scores[2] += -0.047782; scores[3] += -0.050504; break;
      case 6: scores[0] += -0.062608; scores[1] += -0.036566; scores[2] += 0.209039; scores[3] += -0.109864; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 12 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[13] > 0.02817460335791111) << 1) | ((features[44] > 0.15000000596046448) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.333854; scores[1] += -0.103017; scores[2] += -0.100347; scores[3] += -0.130489; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.036394; scores[1] += -0.022837; scores[2] += -0.035956; scores[3] += 0.095187; break;
      case 3: scores[0] += -0.025378; scores[1] += 0.131702; scores[2] += -0.021659; scores[3] += -0.084665; break;
      case 4: scores[0] += -0.056752; scores[1] += -0.016260; scores[2] += 0.005940; scores[3] += 0.067072; break;
      case 5: scores[0] += -0.025657; scores[1] += 0.022381; scores[2] += -0.027003; scores[3] += 0.030279; break;
      case 6: scores[0] += -0.041369; scores[1] += -0.005206; scores[2] += -0.041502; scores[3] += 0.088077; break;
      case 7: scores[0] += -0.086795; scores[1] += 0.343173; scores[2] += -0.088691; scores[3] += -0.167686; break;
    }
  }

  // Tree 13 (depth=3)
  {
    const leafIdx = ((features[13] > 0.3973684310913086) << 0) | ((features[1] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.018286; scores[1] += 0.009665; scores[2] += -0.054046; scores[3] += 0.062667; break;
      case 1: scores[0] += -0.036281; scores[1] += -0.017915; scores[2] += -0.036245; scores[3] += 0.090441; break;
      case 2: scores[0] += 0.003616; scores[1] += 0.159146; scores[2] += -0.057696; scores[3] += -0.105066; break;
      case 3: scores[0] += -0.010064; scores[1] += 0.063186; scores[2] += -0.010378; scores[3] += -0.042744; break;
      case 4: scores[0] += -0.068211; scores[1] += -0.048293; scores[2] += 0.079377; scores[3] += 0.037127; break;
      case 5: scores[0] += -0.030266; scores[1] += -0.025931; scores[2] += -0.031717; scores[3] += 0.087914; break;
      case 6: scores[0] += -0.003711; scores[1] += 0.026670; scores[2] += -0.004158; scores[3] += -0.018800; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 14 (depth=3)
  {
    const leafIdx = ((features[44] > 0.44999998807907104) << 0) | ((features[33] > 0.5) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.039722; scores[1] += 0.002506; scores[2] += -0.041465; scores[3] += 0.078681; break;
      case 1: scores[0] += -0.050980; scores[1] += 0.047634; scores[2] += -0.051404; scores[3] += 0.054749; break;
      case 2: scores[0] += -0.045018; scores[1] += 0.022816; scores[2] += -0.045068; scores[3] += 0.067270; break;
      case 3: scores[0] += -0.025564; scores[1] += 0.020170; scores[2] += -0.026234; scores[3] += 0.031628; break;
      case 4: scores[0] += 0.024945; scores[1] += -0.073210; scores[2] += 0.054467; scores[3] += -0.006202; break;
      case 5: scores[0] += -0.037757; scores[1] += -0.022790; scores[2] += -0.026721; scores[3] += 0.087268; break;
      case 6: scores[0] += -0.034643; scores[1] += -0.020899; scores[2] += -0.034503; scores[3] += 0.090045; break;
      case 7: scores[0] += -0.015948; scores[1] += -0.017669; scores[2] += -0.017762; scores[3] += 0.051379; break;
    }
  }

  // Tree 15 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[11] > 0.07793521881103516) << 1) | ((features[1] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.039347; scores[1] += -0.004011; scores[2] += -0.026658; scores[3] += 0.070016; break;
      case 1: scores[0] += -0.071749; scores[1] += 0.241679; scores[2] += -0.072122; scores[3] += -0.097807; break;
      case 2: scores[0] += -0.000247; scores[1] += -0.052506; scores[2] += -0.005372; scores[3] += 0.058125; break;
      case 3: scores[0] += -0.008978; scores[1] += 0.033703; scores[2] += -0.009569; scores[3] += -0.015156; break;
      case 4: scores[0] += 0.017259; scores[1] += 0.126753; scores[2] += -0.048823; scores[3] += -0.095189; break;
      case 5: scores[0] += -0.022665; scores[1] += 0.106074; scores[2] += -0.021519; scores[3] += -0.061889; break;
      case 6: scores[0] += -0.001369; scores[1] += 0.012967; scores[2] += -0.001463; scores[3] += -0.010135; break;
      case 7: scores[0] += -0.001376; scores[1] += 0.011587; scores[2] += -0.001491; scores[3] += -0.008719; break;
    }
  }

  // Tree 16 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[1] > 0.5) << 1) | ((features[9] > 2.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008451; scores[1] += -0.021372; scores[2] += -0.050998; scores[3] += 0.063919; break;
      case 1: scores[0] += -0.037490; scores[1] += 0.183204; scores[2] += -0.035299; scores[3] += -0.110415; break;
      case 2: scores[0] += 0.066603; scores[1] += -0.016573; scores[2] += -0.011844; scores[3] += -0.038187; break;
      case 3: scores[0] += -0.008684; scores[1] += 0.046142; scores[2] += -0.006688; scores[3] += -0.030769; break;
      case 4: scores[0] += -0.051628; scores[1] += -0.006879; scores[2] += -0.006780; scores[3] += 0.065287; break;
      case 5: scores[0] += -0.044384; scores[1] += 0.130110; scores[2] += -0.046038; scores[3] += -0.039689; break;
      case 6: scores[0] += -0.032075; scores[1] += 0.141495; scores[2] += -0.035142; scores[3] += -0.074278; break;
      case 7: scores[0] += -0.015753; scores[1] += 0.081545; scores[2] += -0.016374; scores[3] += -0.049418; break;
    }
  }

  // Tree 17 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[28] > 0.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008297; scores[1] += -0.030470; scores[2] += 0.006331; scores[3] += 0.032436; break;
      case 1: scores[0] += 0.027140; scores[1] += 0.085825; scores[2] += -0.037712; scores[3] += -0.075253; break;
      case 2: scores[0] += -0.016912; scores[1] += -0.015161; scores[2] += -0.017385; scores[3] += 0.049458; break;
      case 3: scores[0] += -0.003322; scores[1] += 0.020931; scores[2] += -0.003418; scores[3] += -0.014191; break;
      case 4: scores[0] += -0.039486; scores[1] += 0.001200; scores[2] += -0.039647; scores[3] += 0.077933; break;
      case 5: scores[0] += -0.009178; scores[1] += 0.056761; scores[2] += -0.008837; scores[3] += -0.038745; break;
      case 6: scores[0] += -0.050536; scores[1] += 0.210260; scores[2] += -0.050651; scores[3] += -0.109073; break;
      case 7: scores[0] += -0.019047; scores[1] += 0.090052; scores[2] += -0.017954; scores[3] += -0.053052; break;
    }
  }

  // Tree 18 (depth=3)
  {
    const leafIdx = ((features[44] > 0.8500000238418579) << 0) | ((features[28] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.017973; scores[1] += 0.002253; scores[2] += -0.047671; scores[3] += 0.063391; break;
      case 1: scores[0] += -0.004985; scores[1] += -0.006746; scores[2] += -0.004617; scores[3] += 0.016348; break;
      case 2: scores[0] += -0.049528; scores[1] += 0.143589; scores[2] += -0.049141; scores[3] += -0.044920; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.065109; scores[1] += -0.051260; scores[2] += 0.081542; scores[3] += 0.034826; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.010517; scores[1] += 0.076327; scores[2] += -0.012741; scores[3] += -0.053069; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 19 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[44] > 0.15000000596046448) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.277114; scores[1] += -0.081987; scores[2] += -0.078536; scores[3] += -0.116591; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.033658; scores[1] += -0.013150; scores[2] += -0.032684; scores[3] += 0.079493; break;
      case 3: scores[0] += -0.015718; scores[1] += 0.083651; scores[2] += -0.012939; scores[3] += -0.054994; break;
      case 4: scores[0] += -0.063690; scores[1] += -0.005332; scores[2] += 0.024744; scores[3] += 0.044277; break;
      case 5: scores[0] += -0.018185; scores[1] += -0.007382; scores[2] += -0.018680; scores[3] += 0.044247; break;
      case 6: scores[0] += -0.041326; scores[1] += 0.011601; scores[2] += -0.041769; scores[3] += 0.071494; break;
      case 7: scores[0] += -0.035509; scores[1] += 0.150561; scores[2] += -0.036470; scores[3] += -0.078582; break;
    }
  }

  // Tree 20 (depth=3)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[11] > 0.025320513173937798) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.042054; scores[1] += 0.036647; scores[2] += -0.051210; scores[3] += 0.056616; break;
      case 1: scores[0] += -0.018195; scores[1] += -0.025083; scores[2] += -0.020150; scores[3] += 0.063429; break;
      case 2: scores[0] += -0.002559; scores[1] += -0.056044; scores[2] += 0.007193; scores[3] += 0.051410; break;
      case 3: scores[0] += -0.035755; scores[1] += -0.045633; scores[2] += 0.102175; scores[3] += -0.020788; break;
      case 4: scores[0] += -0.071312; scores[1] += 0.265397; scores[2] += -0.066699; scores[3] += -0.127386; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.030847; scores[1] += -0.019152; scores[2] += -0.029265; scores[3] += 0.079264; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 21 (depth=3)
  {
    const leafIdx = ((features[11] > 0.0317540317773819) << 0) | ((features[26] > 0.5) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.053823; scores[1] += 0.053099; scores[2] += -0.050645; scores[3] += 0.051369; break;
      case 1: scores[0] += -0.049208; scores[1] += -0.045745; scores[2] += 0.033747; scores[3] += 0.061206; break;
      case 2: scores[0] += -0.039192; scores[1] += 0.212837; scores[2] += -0.039382; scores[3] += -0.134264; break;
      case 3: scores[0] += -0.005698; scores[1] += 0.062945; scores[2] += -0.005924; scores[3] += -0.051323; break;
      case 4: scores[0] += -0.001309; scores[1] += -0.036929; scores[2] += -0.034350; scores[3] += 0.072587; break;
      case 5: scores[0] += 0.137211; scores[1] += -0.072146; scores[2] += -0.067350; scores[3] += 0.002285; break;
      case 6: scores[0] += -0.040518; scores[1] += 0.129525; scores[2] += -0.035036; scores[3] += -0.053970; break;
      case 7: scores[0] += -0.027493; scores[1] += -0.028292; scores[2] += -0.025865; scores[3] += 0.081650; break;
    }
  }

  // Tree 22 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[28] > 0.5) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.042282; scores[1] += -0.039782; scores[2] += -0.053257; scores[3] += 0.050757; break;
      case 1: scores[0] += 0.057339; scores[1] += -0.014862; scores[2] += -0.008446; scores[3] += -0.034031; break;
      case 2: scores[0] += -0.008463; scores[1] += 0.055150; scores[2] += -0.007460; scores[3] += -0.039227; break;
      case 3: scores[0] += -0.005803; scores[1] += 0.029468; scores[2] += -0.004518; scores[3] += -0.019147; break;
      case 4: scores[0] += -0.057030; scores[1] += 0.008279; scores[2] += -0.001963; scores[3] += 0.050714; break;
      case 5: scores[0] += -0.024085; scores[1] += 0.118915; scores[2] += -0.026290; scores[3] += -0.068541; break;
      case 6: scores[0] += -0.032308; scores[1] += 0.087783; scores[2] += -0.033352; scores[3] += -0.022123; break;
      case 7: scores[0] += -0.010117; scores[1] += 0.057496; scores[2] += -0.010519; scores[3] += -0.036859; break;
    }
  }

  // Tree 23 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[47] > 0.5833333730697632) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.014013; scores[1] += 0.013726; scores[2] += -0.051545; scores[3] += 0.051833; break;
      case 1: scores[0] += 0.013335; scores[1] += 0.098767; scores[2] += -0.036412; scores[3] += -0.075689; break;
      case 2: scores[0] += -0.021000; scores[1] += -0.016219; scores[2] += -0.025460; scores[3] += 0.062679; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.067726; scores[1] += -0.042745; scores[2] += 0.088080; scores[3] += 0.022391; break;
      case 5: scores[0] += -0.002205; scores[1] += 0.014566; scores[2] += -0.002472; scores[3] += -0.009890; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 24 (depth=3)
  {
    const leafIdx = ((features[13] > 0.6120071411132812) << 0) | ((features[10] > 4.2916669845581055) << 1) | ((features[13] > 0.10668563842773438) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.015890; scores[1] += 0.150658; scores[2] += -0.020300; scores[3] += -0.114468; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.001960; scores[1] += -0.015364; scores[2] += 0.002210; scores[3] += 0.011194; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.007521; scores[1] += 0.072480; scores[2] += -0.010265; scores[3] += -0.054694; break;
      case 5: scores[0] += -0.021399; scores[1] += -0.028035; scores[2] += -0.020160; scores[3] += 0.069594; break;
      case 6: scores[0] += -0.051388; scores[1] += 0.050416; scores[2] += -0.051501; scores[3] += 0.052473; break;
      case 7: scores[0] += -0.028207; scores[1] += -0.024319; scores[2] += -0.027904; scores[3] += 0.080431; break;
    }
  }

  // Tree 25 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.066346; scores[1] += 0.002927; scores[2] += 0.028056; scores[3] += 0.035362; break;
      case 1: scores[0] += -0.015009; scores[1] += -0.019490; scores[2] += 0.139947; scores[3] += -0.105448; break;
      case 2: scores[0] += -0.049279; scores[1] += 0.045319; scores[2] += -0.050460; scores[3] += 0.054420; break;
      case 3: scores[0] += -0.010624; scores[1] += -0.021291; scores[2] += -0.013032; scores[3] += 0.044947; break;
      case 4: scores[0] += 0.206108; scores[1] += -0.058819; scores[2] += -0.054220; scores[3] += -0.093070; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.034295; scores[1] += -0.005508; scores[2] += -0.033030; scores[3] += 0.072833; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 26 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[13] > 0.7119815349578857) << 1) | ((features[10] > 5.0833330154418945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.070966; scores[1] += 0.224075; scores[2] += -0.070475; scores[3] += -0.082634; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.022814; scores[1] += -0.026866; scores[2] += -0.021685; scores[3] += 0.071365; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.017755; scores[1] += -0.004325; scores[2] += -0.008013; scores[3] += 0.030093; break;
      case 5: scores[0] += 0.011677; scores[1] += 0.092499; scores[2] += -0.033452; scores[3] += -0.070724; break;
      case 6: scores[0] += -0.026958; scores[1] += -0.025520; scores[2] += -0.026430; scores[3] += 0.078909; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 27 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.174734; scores[1] += -0.050116; scores[2] += -0.045338; scores[3] += -0.079281; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.031815; scores[1] += -0.011057; scores[2] += -0.030366; scores[3] += 0.073238; break;
      case 3: scores[0] += -0.010273; scores[1] += 0.063332; scores[2] += -0.008425; scores[3] += -0.044634; break;
      case 4: scores[0] += -0.069080; scores[1] += 0.001721; scores[2] += 0.037405; scores[3] += 0.029953; break;
      case 5: scores[0] += -0.013564; scores[1] += -0.009909; scores[2] += -0.014715; scores[3] += 0.038188; break;
      case 6: scores[0] += -0.045444; scores[1] += 0.034480; scores[2] += -0.046694; scores[3] += 0.057659; break;
      case 7: scores[0] += -0.019965; scores[1] += 0.106391; scores[2] += -0.020681; scores[3] += -0.065746; break;
    }
  }

  // Tree 28 (depth=3)
  {
    const leafIdx = ((features[11] > 0.011627906933426857) << 0) | ((features[26] > 0.5) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.054408; scores[1] += 0.064897; scores[2] += -0.054117; scores[3] += 0.043628; break;
      case 1: scores[0] += -0.051389; scores[1] += -0.048377; scores[2] += 0.047727; scores[3] += 0.052038; break;
      case 2: scores[0] += -0.025255; scores[1] += 0.180691; scores[2] += -0.026590; scores[3] += -0.128846; break;
      case 3: scores[0] += -0.003743; scores[1] += 0.056001; scores[2] += -0.004060; scores[3] += -0.048199; break;
      case 4: scores[0] += 0.007830; scores[1] += -0.038169; scores[2] += -0.033003; scores[3] += 0.063342; break;
      case 5: scores[0] += 0.114500; scores[1] += -0.062003; scores[2] += -0.053795; scores[3] += 0.001298; break;
      case 6: scores[0] += -0.031860; scores[1] += 0.124994; scores[2] += -0.025249; scores[3] += -0.067886; break;
      case 7: scores[0] += -0.025307; scores[1] += -0.027055; scores[2] += -0.022322; scores[3] += 0.074685; break;
    }
  }

  // Tree 29 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[9] > 3.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005281; scores[1] += 0.000143; scores[2] += -0.052309; scores[3] += 0.046885; break;
      case 1: scores[0] += 0.032545; scores[1] += 0.025869; scores[2] += -0.016025; scores[3] += -0.042390; break;
      case 2: scores[0] += -0.074886; scores[1] += -0.034690; scores[2] += 0.189714; scores[3] += -0.080137; break;
      case 3: scores[0] += -0.001510; scores[1] += 0.010063; scores[2] += -0.001616; scores[3] += -0.006937; break;
      case 4: scores[0] += -0.056585; scores[1] += 0.073462; scores[2] += -0.052156; scores[3] += 0.035280; break;
      case 5: scores[0] += -0.017433; scores[1] += 0.091065; scores[2] += -0.017987; scores[3] += -0.055645; break;
      case 6: scores[0] += -0.044332; scores[1] += -0.038439; scores[2] += 0.034859; scores[3] += 0.047912; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 30 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[31] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.032175; scores[1] += -0.004183; scores[2] += -0.043141; scores[3] += 0.015149; break;
      case 1: scores[0] += -0.011614; scores[1] += -0.011306; scores[2] += -0.012741; scores[3] += 0.035661; break;
      case 2: scores[0] += -0.046086; scores[1] += 0.036359; scores[2] += -0.045730; scores[3] += 0.055457; break;
      case 3: scores[0] += -0.017654; scores[1] += 0.094227; scores[2] += -0.016258; scores[3] += -0.060315; break;
      case 4: scores[0] += -0.058587; scores[1] += -0.067432; scores[2] += 0.168504; scores[3] += -0.042485; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.031403; scores[1] += -0.003833; scores[2] += -0.034608; scores[3] += 0.069845; break;
      case 7: scores[0] += -0.005966; scores[1] += 0.052809; scores[2] += -0.008399; scores[3] += -0.038444; break;
    }
  }

  // Tree 31 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[11] > 0.03637566417455673) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.042137; scores[1] += 0.054840; scores[2] += -0.049875; scores[3] += 0.037172; break;
      case 1: scores[0] += -0.025112; scores[1] += 0.076157; scores[2] += -0.025580; scores[3] += -0.025465; break;
      case 2: scores[0] += 0.014749; scores[1] += -0.057578; scores[2] += 0.003246; scores[3] += 0.039583; break;
      case 3: scores[0] += -0.005189; scores[1] += 0.023052; scores[2] += -0.006497; scores[3] += -0.011366; break;
      case 4: scores[0] += -0.026499; scores[1] += 0.015999; scores[2] += -0.033153; scores[3] += 0.043653; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.038317; scores[1] += -0.061303; scores[2] += 0.139872; scores[3] += -0.040252; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 32 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[13] > 0.024695120751857758) << 1) | ((features[44] > 0.15000000596046448) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.142677; scores[1] += -0.040393; scores[2] += -0.033663; scores[3] += -0.068621; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.035531; scores[1] += 0.003577; scores[2] += -0.031162; scores[3] += 0.063116; break;
      case 3: scores[0] += -0.007047; scores[1] += 0.043308; scores[2] += -0.005320; scores[3] += -0.030941; break;
      case 4: scores[0] += -0.070240; scores[1] += 0.006205; scores[2] += 0.038759; scores[3] += 0.025277; break;
      case 5: scores[0] += -0.011110; scores[1] += -0.012902; scores[2] += -0.012183; scores[3] += 0.036195; break;
      case 6: scores[0] += -0.044006; scores[1] += 0.032934; scores[2] += -0.045473; scores[3] += 0.056545; break;
      case 7: scores[0] += -0.014547; scores[1] += 0.085557; scores[2] += -0.015564; scores[3] += -0.055446; break;
    }
  }

  // Tree 33 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002092; scores[1] += 0.023794; scores[2] += -0.057816; scores[3] += 0.036115; break;
      case 1: scores[0] += 0.014416; scores[1] += 0.074694; scores[2] += -0.025029; scores[3] += -0.064081; break;
      case 2: scores[0] += -0.055842; scores[1] += -0.028251; scores[2] += 0.057366; scores[3] += 0.026728; break;
      case 3: scores[0] += -0.001280; scores[1] += 0.008178; scores[2] += -0.001364; scores[3] += -0.005534; break;
      case 4: scores[0] += -0.022319; scores[1] += -0.029829; scores[2] += -0.012637; scores[3] += 0.064785; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.025788; scores[1] += -0.033553; scores[2] += 0.249562; scores[3] += -0.190221; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 34 (depth=3)
  {
    const leafIdx = ((features[10] > 6.2916669845581055) << 0) | ((features[34] > 0.05000000074505806) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.030234; scores[1] += 0.003050; scores[2] += -0.017857; scores[3] += 0.045041; break;
      case 1: scores[0] += -0.008395; scores[1] += 0.006119; scores[2] += -0.046149; scores[3] += 0.048425; break;
      case 2: scores[0] += -0.061603; scores[1] += 0.034419; scores[2] += 0.026892; scores[3] += 0.000292; break;
      case 3: scores[0] += 0.002831; scores[1] += -0.026912; scores[2] += 0.007825; scores[3] += 0.016256; break;
      case 4: scores[0] += -0.067595; scores[1] += 0.298553; scores[2] += -0.055317; scores[3] += -0.175642; break;
      case 5: scores[0] += -0.024590; scores[1] += 0.015252; scores[2] += -0.018323; scores[3] += 0.027661; break;
      case 6: scores[0] += -0.020406; scores[1] += -0.037283; scores[2] += 0.004647; scores[3] += 0.053042; break;
      case 7: scores[0] += -0.030137; scores[1] += -0.039325; scores[2] += 0.012501; scores[3] += 0.056961; break;
    }
  }

  // Tree 35 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[11] > 0.024695120751857758) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.045878; scores[1] += 0.062894; scores[2] += -0.055187; scores[3] += 0.038172; break;
      case 1: scores[0] += 0.016685; scores[1] += 0.064703; scores[2] += -0.022236; scores[3] += -0.059153; break;
      case 2: scores[0] += 0.025923; scores[1] += -0.002907; scores[2] += -0.001206; scores[3] += -0.021811; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.006855; scores[1] += -0.063521; scores[2] += 0.027005; scores[3] += 0.029662; break;
      case 5: scores[0] += -0.001453; scores[1] += 0.015278; scores[2] += -0.001745; scores[3] += -0.012080; break;
      case 6: scores[0] += 0.039928; scores[1] += -0.004148; scores[2] += -0.002761; scores[3] += -0.033019; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 36 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[4] > 0.5) << 1) | ((features[13] > 0.25462961196899414) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.069981; scores[1] += 0.017390; scores[2] += 0.027547; scores[3] += 0.025044; break;
      case 1: scores[0] += -0.012209; scores[1] += 0.151403; scores[2] += -0.011901; scores[3] += -0.127293; break;
      case 2: scores[0] += 0.130636; scores[1] += -0.038675; scores[2] += -0.030405; scores[3] += -0.061556; break;
      case 3: scores[0] += -0.033696; scores[1] += 0.024209; scores[2] += -0.024091; scores[3] += 0.033578; break;
      case 4: scores[0] += -0.040097; scores[1] += 0.025272; scores[2] += -0.041316; scores[3] += 0.056142; break;
      case 5: scores[0] += -0.008741; scores[1] += 0.114623; scores[2] += -0.009671; scores[3] += -0.096211; break;
      case 6: scores[0] += -0.025094; scores[1] += -0.026964; scores[2] += -0.021411; scores[3] += 0.073469; break;
      case 7: scores[0] += -0.037876; scores[1] += 0.035000; scores[2] += -0.030067; scores[3] += 0.032943; break;
    }
  }

  // Tree 37 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[13] > 0.614143967628479) << 1) | ((features[10] > 4.9166669845581055) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.030746; scores[1] += 0.152854; scores[2] += -0.034918; scores[3] += -0.087190; break;
      case 1: scores[0] += -0.001031; scores[1] += 0.041699; scores[2] += -0.001716; scores[3] += -0.038952; break;
      case 2: scores[0] += -0.015031; scores[1] += -0.030533; scores[2] += -0.013657; scores[3] += 0.059222; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.008659; scores[1] += 0.004140; scores[2] += -0.004723; scores[3] += 0.009243; break;
      case 5: scores[0] += -0.000257; scores[1] += 0.014331; scores[2] += -0.000435; scores[3] += -0.013639; break;
      case 6: scores[0] += -0.026218; scores[1] += -0.021593; scores[2] += -0.024987; scores[3] += 0.072798; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 38 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[27] > 0.5) << 1) | ((features[11] > 0.06857366859912872) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.027525; scores[1] += 0.047854; scores[2] += -0.053673; scores[3] += 0.033343; break;
      case 1: scores[0] += -0.041257; scores[1] += -0.008551; scores[2] += 0.009216; scores[3] += 0.040592; break;
      case 2: scores[0] += -0.017609; scores[1] += -0.030720; scores[2] += -0.005432; scores[3] += 0.053760; break;
      case 3: scores[0] += -0.005688; scores[1] += -0.008411; scores[2] += 0.106300; scores[3] += -0.092201; break;
      case 4: scores[0] += 0.055443; scores[1] += -0.042295; scores[2] += -0.050966; scores[3] += 0.037817; break;
      case 5: scores[0] += -0.042539; scores[1] += -0.042903; scores[2] += 0.111652; scores[3] += -0.026211; break;
      case 6: scores[0] += -0.014510; scores[1] += -0.020080; scores[2] += -0.012888; scores[3] += 0.047478; break;
      case 7: scores[0] += -0.012956; scores[1] += -0.017628; scores[2] += 0.164145; scores[3] += -0.133561; break;
    }
  }

  // Tree 39 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[10] > 6.2916669845581055) << 1) | ((features[13] > 0.17519181966781616) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.075243; scores[1] += 0.114776; scores[2] += 0.002296; scores[3] += -0.041829; break;
      case 1: scores[0] += -0.004188; scores[1] += 0.035720; scores[2] += -0.005026; scores[3] += -0.026506; break;
      case 2: scores[0] += 0.034250; scores[1] += -0.055396; scores[2] += 0.011194; scores[3] += 0.009952; break;
      case 3: scores[0] += 0.024134; scores[1] += 0.043040; scores[2] += -0.015809; scores[3] += -0.051364; break;
      case 4: scores[0] += -0.034663; scores[1] += 0.027183; scores[2] += -0.036975; scores[3] += 0.044455; break;
      case 5: scores[0] += -0.000711; scores[1] += 0.005545; scores[2] += -0.000806; scores[3] += -0.004029; break;
      case 6: scores[0] += -0.043233; scores[1] += 0.030857; scores[2] += -0.042379; scores[3] += 0.054755; break;
      case 7: scores[0] += -0.005590; scores[1] += 0.039754; scores[2] += -0.004259; scores[3] += -0.029904; break;
    }
  }

  // Tree 40 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[13] > 0.3207142949104309) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.073087; scores[1] += 0.030224; scores[2] += 0.023607; scores[3] += 0.019256; break;
      case 1: scores[0] += -0.011353; scores[1] += 0.066911; scores[2] += -0.013339; scores[3] += -0.042219; break;
      case 2: scores[0] += -0.037884; scores[1] += 0.022014; scores[2] += -0.039295; scores[3] += 0.055165; break;
      case 3: scores[0] += -0.003379; scores[1] += 0.032934; scores[2] += -0.002980; scores[3] += -0.026576; break;
      case 4: scores[0] += 0.094833; scores[1] += -0.014871; scores[2] += -0.053504; scores[3] += -0.026458; break;
      case 5: scores[0] += 0.032657; scores[1] += -0.004727; scores[2] += -0.004935; scores[3] += -0.022995; break;
      case 6: scores[0] += -0.030384; scores[1] += -0.008307; scores[2] += -0.025763; scores[3] += 0.064454; break;
      case 7: scores[0] += -0.001060; scores[1] += 0.005128; scores[2] += -0.000630; scores[3] += -0.003438; break;
    }
  }

  // Tree 41 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[27] > 0.5) << 1) | ((features[44] > 0.3500000238418579) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.024492; scores[1] += 0.007669; scores[2] += -0.059648; scores[3] += 0.027488; break;
      case 1: scores[0] += -0.045028; scores[1] += 0.001136; scores[2] += 0.103128; scores[3] += -0.059235; break;
      case 2: scores[0] += -0.017937; scores[1] += -0.026512; scores[2] += -0.010318; scores[3] += 0.054767; break;
      case 3: scores[0] += -0.004729; scores[1] += -0.006488; scores[2] += 0.084073; scores[3] += -0.072856; break;
      case 4: scores[0] += -0.052074; scores[1] += 0.065463; scores[2] += -0.046508; scores[3] += 0.033119; break;
      case 5: scores[0] += -0.033090; scores[1] += -0.027437; scores[2] += 0.008998; scores[3] += 0.051529; break;
      case 6: scores[0] += -0.009473; scores[1] += -0.026489; scores[2] += -0.001277; scores[3] += 0.037239; break;
      case 7: scores[0] += -0.011259; scores[1] += -0.019506; scores[2] += 0.153745; scores[3] += -0.122981; break;
    }
  }

  // Tree 42 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[10] > 11.125) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.035774; scores[1] += -0.004982; scores[2] += 0.028862; scores[3] += 0.011894; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.088725; scores[1] += -0.065716; scores[2] += 0.041258; scores[3] += -0.064267; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.042960; scores[1] += 0.037902; scores[2] += -0.046913; scores[3] += 0.051971; break;
      case 5: scores[0] += -0.022088; scores[1] += 0.167139; scores[2] += -0.018628; scores[3] += -0.126422; break;
      case 6: scores[0] += -0.024343; scores[1] += -0.023747; scores[2] += -0.019663; scores[3] += 0.067752; break;
      case 7: scores[0] += -0.040149; scores[1] += 0.029167; scores[2] += -0.029291; scores[3] += 0.040274; break;
    }
  }

  // Tree 43 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.016593; scores[1] += -0.021663; scores[2] += -0.006011; scores[3] += 0.011081; break;
      case 1: scores[0] += -0.010789; scores[1] += 0.015175; scores[2] += -0.012639; scores[3] += 0.008253; break;
      case 2: scores[0] += -0.052881; scores[1] += 0.065602; scores[2] += -0.050886; scores[3] += 0.038165; break;
      case 3: scores[0] += -0.009841; scores[1] += 0.073546; scores[2] += -0.010250; scores[3] += -0.053455; break;
      case 4: scores[0] += -0.014124; scores[1] += -0.024975; scores[2] += 0.153300; scores[3] += -0.114201; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.017056; scores[1] += -0.027423; scores[2] += -0.015359; scores[3] += 0.059838; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 44 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[11] > 0.0317540317773819) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.026173; scores[1] += 0.039844; scores[2] += -0.048343; scores[3] += 0.034672; break;
      case 1: scores[0] += -0.012408; scores[1] += 0.043637; scores[2] += -0.014763; scores[3] += -0.016466; break;
      case 2: scores[0] += 0.022822; scores[1] += -0.071388; scores[2] += 0.029811; scores[3] += 0.018754; break;
      case 3: scores[0] += -0.001806; scores[1] += 0.000482; scores[2] += -0.002802; scores[3] += 0.004127; break;
      case 4: scores[0] += -0.027380; scores[1] += 0.162399; scores[2] += -0.020862; scores[3] += -0.114156; break;
      case 5: scores[0] += -0.006982; scores[1] += 0.049522; scores[2] += -0.005474; scores[3] += -0.037066; break;
      case 6: scores[0] += -0.025287; scores[1] += -0.017348; scores[2] += -0.017603; scores[3] += 0.060239; break;
      case 7: scores[0] += -0.001464; scores[1] += 0.017960; scores[2] += -0.001963; scores[3] += -0.014533; break;
    }
  }

  // Tree 45 (depth=3)
  {
    const leafIdx = ((features[10] > 5.449999809265137) << 0) | ((features[14] > 0.5) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.032759; scores[1] += 0.127420; scores[2] += -0.037630; scores[3] += -0.057031; break;
      case 1: scores[0] += 0.024056; scores[1] += -0.044273; scores[2] += 0.002017; scores[3] += 0.018200; break;
      case 2: scores[0] += -0.023150; scores[1] += 0.017814; scores[2] += -0.023889; scores[3] += 0.029226; break;
      case 3: scores[0] += -0.054792; scores[1] += 0.074887; scores[2] += -0.052137; scores[3] += 0.032042; break;
      case 4: scores[0] += -0.000181; scores[1] += -0.002080; scores[2] += 0.016131; scores[3] += -0.013870; break;
      case 5: scores[0] += -0.012288; scores[1] += -0.018212; scores[2] += 0.126152; scores[3] += -0.095652; break;
      case 6: scores[0] += -0.004410; scores[1] += -0.020716; scores[2] += -0.004475; scores[3] += 0.029601; break;
      case 7: scores[0] += -0.015942; scores[1] += -0.025217; scores[2] += -0.014100; scores[3] += 0.055259; break;
    }
  }

  // Tree 46 (depth=3)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[20] > 0.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.073996; scores[1] += -0.058456; scores[2] += -0.050425; scores[3] += 0.034886; break;
      case 1: scores[0] += -0.042099; scores[1] += -0.049121; scores[2] += 0.109911; scores[3] += -0.018691; break;
      case 2: scores[0] += -0.028153; scores[1] += 0.200364; scores[2] += -0.002467; scores[3] += -0.169744; break;
      case 3: scores[0] += -0.026902; scores[1] += -0.036444; scores[2] += 0.019953; scores[3] += 0.043393; break;
      case 4: scores[0] += -0.052410; scores[1] += 0.062341; scores[2] += -0.049276; scores[3] += 0.039346; break;
      case 5: scores[0] += -0.026097; scores[1] += 0.029429; scores[2] += -0.046832; scores[3] += 0.043500; break;
      case 6: scores[0] += -0.010896; scores[1] += -0.034350; scores[2] += -0.012824; scores[3] += 0.058071; break;
      case 7: scores[0] += -0.011668; scores[1] += -0.032830; scores[2] += -0.017976; scores[3] += 0.062474; break;
    }
  }

  // Tree 47 (depth=3)
  {
    const leafIdx = ((features[13] > 0.47913044691085815) << 0) | ((features[10] > 4.775000095367432) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002824; scores[1] += 0.021262; scores[2] += -0.008333; scores[3] += -0.010104; break;
      case 1: scores[0] += -0.011628; scores[1] += -0.022839; scores[2] += -0.009736; scores[3] += 0.044204; break;
      case 2: scores[0] += 0.004328; scores[1] += -0.003216; scores[2] += 0.001372; scores[3] += -0.002485; break;
      case 3: scores[0] += -0.030864; scores[1] += -0.001789; scores[2] += -0.028732; scores[3] += 0.061386; break;
      case 4: scores[0] += -0.011903; scores[1] += 0.106069; scores[2] += -0.006243; scores[3] += -0.087923; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.050953; scores[1] += 0.051731; scores[2] += -0.009610; scores[3] += 0.008832; break;
      case 7: scores[0] += -0.008579; scores[1] += -0.031858; scores[2] += -0.010889; scores[3] += 0.051326; break;
    }
  }

  // Tree 48 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.068272; scores[1] += 0.004706; scores[2] += 0.041800; scores[3] += 0.021766; break;
      case 1: scores[0] += -0.000827; scores[1] += 0.038803; scores[2] += -0.001693; scores[3] += -0.036283; break;
      case 2: scores[0] += -0.046815; scores[1] += 0.059245; scores[2] += -0.052974; scores[3] += 0.040544; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.100753; scores[1] += -0.027619; scores[2] += -0.019078; scores[3] += -0.054056; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.035079; scores[1] += 0.006048; scores[2] += -0.027589; scores[3] += 0.056619; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 49 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[41] > 0.5) << 1) | ((features[14] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009861; scores[1] += -0.023911; scores[2] += 0.008364; scores[3] += 0.005686; break;
      case 1: scores[0] += 0.017908; scores[1] += 0.043845; scores[2] += -0.013913; scores[3] += -0.047840; break;
      case 2: scores[0] += -0.012582; scores[1] += -0.020649; scores[2] += -0.006332; scores[3] += 0.039563; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.058250; scores[1] += 0.104072; scores[2] += -0.056286; scores[3] += 0.010463; break;
      case 5: scores[0] += -0.003594; scores[1] += 0.034222; scores[2] += -0.002765; scores[3] += -0.027864; break;
      case 6: scores[0] += -0.022066; scores[1] += -0.026937; scores[2] += -0.019189; scores[3] += 0.068192; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 50 (depth=3)
  {
    const leafIdx = ((features[5] > 0.5) << 0) | ((features[1] > 0.5) << 1) | ((features[13] > 0.43614131212234497) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009250; scores[1] += 0.013606; scores[2] += -0.001705; scores[3] += -0.002651; break;
      case 1: scores[0] += 0.038736; scores[1] += -0.003580; scores[2] += -0.002217; scores[3] += -0.032939; break;
      case 2: scores[0] += 0.016230; scores[1] += 0.045129; scores[2] += -0.014218; scores[3] += -0.047141; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.032237; scores[1] += 0.004067; scores[2] += -0.030913; scores[3] += 0.059084; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001373; scores[1] += 0.023828; scores[2] += -0.001154; scores[3] += -0.021300; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 51 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.013230; scores[1] += 0.024932; scores[2] += -0.059820; scores[3] += 0.021658; break;
      case 1: scores[0] += -0.000827; scores[1] += 0.037901; scores[2] += -0.001702; scores[3] += -0.035373; break;
      case 2: scores[0] += -0.047221; scores[1] += -0.020405; scores[2] += 0.047739; scores[3] += 0.019886; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.015069; scores[1] += -0.031431; scores[2] += -0.000932; scores[3] += 0.047432; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.009020; scores[1] += -0.013984; scores[2] += 0.101926; scores[3] += -0.078922; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 52 (depth=3)
  {
    const leafIdx = ((features[10] > 5.775000095367432) << 0) | ((features[17] > 0.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.034059; scores[1] += 0.081029; scores[2] += -0.010916; scores[3] += -0.036053; break;
      case 1: scores[0] += 0.032591; scores[1] += -0.054205; scores[2] += 0.015576; scores[3] += 0.006038; break;
      case 2: scores[0] += -0.000301; scores[1] += -0.001570; scores[2] += 0.015513; scores[3] += -0.013641; break;
      case 3: scores[0] += -0.003465; scores[1] += -0.005266; scores[2] += 0.076878; scores[3] += -0.068147; break;
      case 4: scores[0] += -0.025651; scores[1] += 0.030586; scores[2] += -0.029920; scores[3] += 0.024986; break;
      case 5: scores[0] += -0.046028; scores[1] += 0.048575; scores[2] += -0.048297; scores[3] += 0.045751; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.003534; scores[1] += -0.018219; scores[2] += -0.004746; scores[3] += 0.026499; break;
    }
  }

  // Tree 53 (depth=3)
  {
    const leafIdx = ((features[10] > 6.2916669845581055) << 0) | ((features[26] > 0.5) << 1) | ((features[10] > 11.291666030883789) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.057315; scores[1] += 0.045774; scores[2] += 0.009835; scores[3] += 0.001706; break;
      case 1: scores[0] += -0.028833; scores[1] += -0.012595; scores[2] += 0.012679; scores[3] += 0.028749; break;
      case 2: scores[0] += -0.001711; scores[1] += 0.062073; scores[2] += -0.003652; scores[3] += -0.056710; break;
      case 3: scores[0] += -0.010275; scores[1] += 0.104655; scores[2] += -0.006750; scores[3] += -0.087631; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.065242; scores[1] += -0.079398; scores[2] += 0.026400; scores[3] += -0.012243; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.031686; scores[1] += 0.016877; scores[2] += -0.020033; scores[3] += 0.034842; break;
    }
  }

  // Tree 54 (depth=3)
  {
    const leafIdx = ((features[11] > 0.03077651560306549) << 0) | ((features[9] > 4.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.020849; scores[1] += 0.045054; scores[2] += -0.052848; scores[3] += 0.028643; break;
      case 1: scores[0] += 0.048075; scores[1] += -0.051593; scores[2] += -0.033005; scores[3] += 0.036522; break;
      case 2: scores[0] += -0.013168; scores[1] += 0.111687; scores[2] += -0.018886; scores[3] += -0.079633; break;
      case 3: scores[0] += -0.010207; scores[1] += -0.010335; scores[2] += -0.021827; scores[3] += 0.042369; break;
      case 4: scores[0] += -0.012384; scores[1] += 0.013531; scores[2] += -0.002290; scores[3] += 0.001143; break;
      case 5: scores[0] += -0.037589; scores[1] += -0.044372; scores[2] += 0.092593; scores[3] += -0.010632; break;
      case 6: scores[0] += -0.003591; scores[1] += -0.013059; scores[2] += -0.013641; scores[3] += 0.030291; break;
      case 7: scores[0] += -0.016130; scores[1] += -0.022072; scores[2] += -0.019452; scores[3] += 0.057654; break;
    }
  }

  // Tree 55 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[44] > 0.550000011920929) << 1) | ((features[14] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.017122; scores[1] += -0.030231; scores[2] += 0.023511; scores[3] += -0.010402; break;
      case 1: scores[0] += -0.028035; scores[1] += 0.014127; scores[2] += -0.042376; scores[3] += 0.056283; break;
      case 2: scores[0] += -0.010601; scores[1] += -0.022709; scores[2] += -0.010609; scores[3] += 0.043920; break;
      case 3: scores[0] += -0.001196; scores[1] += 0.052690; scores[2] += -0.002854; scores[3] += -0.048640; break;
      case 4: scores[0] += -0.050864; scores[1] += 0.068194; scores[2] += -0.046150; scores[3] += 0.028821; break;
      case 5: scores[0] += -0.014359; scores[1] += -0.001902; scores[2] += -0.016026; scores[3] += 0.032287; break;
      case 6: scores[0] += -0.007043; scores[1] += -0.025546; scores[2] += -0.004928; scores[3] += 0.037517; break;
      case 7: scores[0] += -0.000086; scores[1] += -0.001385; scores[2] += -0.000072; scores[3] += 0.001543; break;
    }
  }

  // Tree 56 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[32] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.023330; scores[1] += -0.015346; scores[2] += -0.007115; scores[3] += -0.000869; break;
      case 1: scores[0] += -0.006737; scores[1] += -0.015848; scores[2] += -0.007673; scores[3] += 0.030258; break;
      case 2: scores[0] += -0.044620; scores[1] += 0.045365; scores[2] += -0.046518; scores[3] += 0.045773; break;
      case 3: scores[0] += -0.006192; scores[1] += 0.066882; scores[2] += -0.006312; scores[3] += -0.054378; break;
      case 4: scores[0] += -0.013692; scores[1] += 0.034036; scores[2] += 0.087344; scores[3] += -0.107688; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.010189; scores[1] += -0.030575; scores[2] += -0.019577; scores[3] += 0.060341; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 57 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[11] > 0.025978408753871918) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.018232; scores[1] += 0.041423; scores[2] += -0.052620; scores[3] += 0.029430; break;
      case 1: scores[0] += -0.000665; scores[1] += 0.035088; scores[2] += -0.001381; scores[3] += -0.033043; break;
      case 2: scores[0] += 0.024594; scores[1] += -0.069436; scores[2] += 0.028218; scores[3] += 0.016624; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.012037; scores[1] += 0.095988; scores[2] += -0.008763; scores[3] += -0.075189; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.021185; scores[1] += -0.015902; scores[2] += -0.012608; scores[3] += 0.049695; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 58 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[14] > 0.5) << 1) | ((features[10] > 4.775000095367432) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.007033; scores[1] += 0.064894; scores[2] += -0.002505; scores[3] += -0.055356; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.009637; scores[1] += -0.007313; scores[2] += -0.009687; scores[3] += 0.026637; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.013925; scores[1] += -0.030510; scores[2] += 0.007500; scores[3] += 0.009086; break;
      case 5: scores[0] += -0.001544; scores[1] += -0.006295; scores[2] += 0.052774; scores[3] += -0.044936; break;
      case 6: scores[0] += -0.047756; scores[1] += 0.059938; scores[2] += -0.043571; scores[3] += 0.031388; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 59 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[32] > 0.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.020208; scores[1] += -0.016991; scores[2] += -0.004513; scores[3] += 0.001296; break;
      case 1: scores[0] += 0.018307; scores[1] += 0.031425; scores[2] += -0.008672; scores[3] += -0.041060; break;
      case 2: scores[0] += -0.011179; scores[1] += 0.025659; scores[2] += 0.084784; scores[3] += -0.099263; break;
      case 3: scores[0] += -0.002036; scores[1] += 0.016002; scores[2] += -0.003964; scores[3] += -0.010001; break;
      case 4: scores[0] += -0.045104; scores[1] += 0.049307; scores[2] += -0.047231; scores[3] += 0.043028; break;
      case 5: scores[0] += -0.003151; scores[1] += 0.036508; scores[2] += -0.002284; scores[3] += -0.031073; break;
      case 6: scores[0] += -0.009782; scores[1] += -0.029938; scores[2] += -0.018897; scores[3] += 0.058617; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 60 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[9] > 4.5) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.029928; scores[1] += 0.027342; scores[2] += -0.031427; scores[3] += 0.034013; break;
      case 1: scores[0] += -0.011036; scores[1] += 0.020880; scores[2] += -0.033731; scores[3] += 0.023886; break;
      case 2: scores[0] += -0.014679; scores[1] += 0.094215; scores[2] += -0.021191; scores[3] += -0.058345; break;
      case 3: scores[0] += -0.002319; scores[1] += -0.006576; scores[2] += -0.008992; scores[3] += 0.017887; break;
      case 4: scores[0] += 0.067475; scores[1] += -0.025343; scores[2] += -0.056875; scores[3] += 0.014743; break;
      case 5: scores[0] += -0.034132; scores[1] += -0.038396; scores[2] += 0.084154; scores[3] += -0.011626; break;
      case 6: scores[0] += -0.011072; scores[1] += 0.003347; scores[2] += -0.023330; scores[3] += 0.031055; break;
      case 7: scores[0] += -0.015580; scores[1] += -0.023678; scores[2] += -0.017416; scores[3] += 0.056674; break;
    }
  }

  // Tree 61 (depth=3)
  {
    const leafIdx = ((features[41] > 0.5) << 0) | ((features[10] > 4.816666603088379) << 1) | ((features[43] > 0.22401434183120728) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.006957; scores[1] += 0.063260; scores[2] += -0.002256; scores[3] += -0.054047; break;
      case 1: scores[0] += -0.000061; scores[1] += -0.001811; scores[2] += -0.000058; scores[3] += 0.001930; break;
      case 2: scores[0] += -0.001597; scores[1] += 0.009552; scores[2] += -0.004080; scores[3] += -0.003875; break;
      case 3: scores[0] += -0.017926; scores[1] += -0.027461; scores[2] += -0.012056; scores[3] += 0.057442; break;
      case 4: scores[0] += -0.002092; scores[1] += 0.005030; scores[2] += -0.004234; scores[3] += 0.001297; break;
      case 5: scores[0] += -0.005176; scores[1] += -0.034253; scores[2] += -0.003978; scores[3] += 0.043408; break;
      case 6: scores[0] += -0.023173; scores[1] += 0.011866; scores[2] += -0.018336; scores[3] += 0.029644; break;
      case 7: scores[0] += -0.010070; scores[1] += -0.035696; scores[2] += -0.006692; scores[3] += 0.052459; break;
    }
  }

  // Tree 62 (depth=3)
  {
    const leafIdx = ((features[42] > 0.5) << 0) | ((features[13] > 0.023532669991254807) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.086367; scores[1] += -0.023278; scores[2] += -0.013960; scores[3] += -0.049128; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.031253; scores[1] += 0.001386; scores[2] += -0.019594; scores[3] += 0.049461; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.061605; scores[1] += 0.012820; scores[2] += 0.019779; scores[3] += 0.029006; break;
      case 5: scores[0] += -0.012283; scores[1] += 0.024211; scores[2] += 0.086832; scores[3] += -0.098760; break;
      case 6: scores[0] += -0.041176; scores[1] += 0.060941; scores[2] += -0.051394; scores[3] += 0.031630; break;
      case 7: scores[0] += -0.009355; scores[1] += -0.030701; scores[2] += -0.017771; scores[3] += 0.057827; break;
    }
  }

  // Tree 63 (depth=3)
  {
    const leafIdx = ((features[11] > 0.04706533998250961) << 0) | ((features[26] > 0.5) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.055828; scores[1] += 0.041268; scores[2] += -0.008567; scores[3] += 0.023126; break;
      case 1: scores[0] += -0.047020; scores[1] += -0.041452; scores[2] += 0.045407; scores[3] += 0.043065; break;
      case 2: scores[0] += -0.003325; scores[1] += 0.083136; scores[2] += -0.003468; scores[3] += -0.076343; break;
      case 3: scores[0] += -0.000775; scores[1] += 0.040937; scores[2] += -0.001025; scores[3] += -0.039137; break;
      case 4: scores[0] += 0.049220; scores[1] += -0.057443; scores[2] += -0.014862; scores[3] += 0.023084; break;
      case 5: scores[0] += 0.076970; scores[1] += -0.038775; scores[2] += -0.020044; scores[3] += -0.018152; break;
      case 6: scores[0] += -0.009130; scores[1] += 0.049184; scores[2] += -0.005195; scores[3] += -0.034859; break;
      case 7: scores[0] += -0.014234; scores[1] += -0.031191; scores[2] += -0.007390; scores[3] += 0.052815; break;
    }
  }

  // Tree 64 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.015142; scores[1] += 0.021921; scores[2] += -0.054707; scores[3] += 0.017644; break;
      case 1: scores[0] += -0.000522; scores[1] += 0.031770; scores[2] += -0.001207; scores[3] += -0.030041; break;
      case 2: scores[0] += -0.039324; scores[1] += -0.015022; scores[2] += 0.035420; scores[3] += 0.018926; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.009453; scores[1] += -0.034457; scores[2] += 0.006184; scores[3] += 0.037726; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.006082; scores[1] += -0.008368; scores[2] += 0.080585; scores[3] += -0.066135; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 65 (depth=3)
  {
    const leafIdx = ((features[32] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.037892; scores[1] += -0.072868; scores[2] += 0.020320; scores[3] += 0.014656; break;
      case 1: scores[0] += -0.003482; scores[1] += -0.007075; scores[2] += 0.070031; scores[3] += -0.059474; break;
      case 2: scores[0] += -0.046766; scores[1] += 0.062305; scores[2] += -0.049528; scores[3] += 0.033990; break;
      case 3: scores[0] += -0.006239; scores[1] += -0.026760; scores[2] += -0.014523; scores[3] += 0.047522; break;
      case 4: scores[0] += -0.042370; scores[1] += 0.143324; scores[2] += -0.066056; scores[3] += -0.034898; break;
      case 5: scores[0] += -0.006684; scores[1] += 0.031886; scores[2] += 0.057266; scores[3] += -0.082468; break;
      case 6: scores[0] += -0.007669; scores[1] += -0.040195; scores[2] += -0.010065; scores[3] += 0.057928; break;
      case 7: scores[0] += -0.004621; scores[1] += -0.025972; scores[2] += -0.010099; scores[3] += 0.040693; break;
    }
  }

  // Tree 66 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[34] > 0.25) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.017164; scores[1] += 0.011066; scores[2] += -0.047597; scores[3] += 0.019367; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.030178; scores[1] += 0.012456; scores[2] += 0.085035; scores[3] += -0.067314; break;
      case 3: scores[0] += -0.013003; scores[1] += -0.033169; scores[2] += -0.001607; scores[3] += 0.047779; break;
      case 4: scores[0] += -0.020091; scores[1] += 0.077034; scores[2] += -0.038892; scores[3] += -0.018050; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.010798; scores[1] += -0.003928; scores[2] += -0.040438; scores[3] += 0.055164; break;
      case 7: scores[0] += -0.007403; scores[1] += -0.034774; scores[2] += 0.027534; scores[3] += 0.014643; break;
    }
  }

  // Tree 67 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[44] > 0.44999998807907104) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.021311; scores[1] += 0.014130; scores[2] += -0.042990; scores[3] += 0.007549; break;
      case 1: scores[0] += -0.024569; scores[1] += 0.000601; scores[2] += -0.030872; scores[3] += 0.054840; break;
      case 2: scores[0] += -0.034520; scores[1] += -0.009291; scores[2] += 0.060403; scores[3] += -0.016592; break;
      case 3: scores[0] += -0.002775; scores[1] += -0.014856; scores[2] += -0.030021; scores[3] += 0.047652; break;
      case 4: scores[0] += -0.019715; scores[1] += 0.028376; scores[2] += -0.028953; scores[3] += 0.020292; break;
      case 5: scores[0] += -0.002280; scores[1] += 0.076335; scores[2] += -0.004595; scores[3] += -0.069461; break;
      case 6: scores[0] += -0.012321; scores[1] += -0.018394; scores[2] += -0.013663; scores[3] += 0.044378; break;
      case 7: scores[0] += -0.004555; scores[1] += -0.008149; scores[2] += -0.029690; scores[3] += 0.042395; break;
    }
  }

  // Tree 68 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[11] > 0.037749290466308594) << 1) | ((features[13] > 0.35857143998146057) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.019452; scores[1] += 0.052861; scores[2] += -0.031070; scores[3] += -0.002339; break;
      case 1: scores[0] += -0.000446; scores[1] += 0.029235; scores[2] += -0.000938; scores[3] += -0.027852; break;
      case 2: scores[0] += 0.027553; scores[1] += -0.061816; scores[2] += 0.020744; scores[3] += 0.013519; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.027400; scores[1] += 0.012816; scores[2] += -0.024858; scores[3] += 0.039443; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.019439; scores[1] += -0.022505; scores[2] += -0.014601; scores[3] += 0.056545; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 69 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[13] > 0.5375235080718994) << 1) | ((features[10] > 6.449999809265137) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.052446; scores[1] += 0.048291; scores[2] += 0.017339; scores[3] += -0.013184; break;
      case 1: scores[0] += -0.003395; scores[1] += -0.004578; scores[2] += -0.004985; scores[3] += 0.012959; break;
      case 2: scores[0] += -0.008070; scores[1] += -0.025098; scores[2] += -0.006082; scores[3] += 0.039249; break;
      case 3: scores[0] += -0.000265; scores[1] += 0.024358; scores[2] += -0.000251; scores[3] += -0.023842; break;
      case 4: scores[0] += 0.013995; scores[1] += -0.013325; scores[2] += -0.004061; scores[3] += 0.003391; break;
      case 5: scores[0] += -0.007071; scores[1] += 0.046136; scores[2] += -0.005615; scores[3] += -0.033450; break;
      case 6: scores[0] += -0.019521; scores[1] += -0.023785; scores[2] += -0.013752; scores[3] += 0.057057; break;
      case 7: scores[0] += -0.000267; scores[1] += 0.013504; scores[2] += -0.000193; scores[3] += -0.013044; break;
    }
  }

  // Tree 70 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[11] > 0.027402402833104134) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.011274; scores[1] += 0.032890; scores[2] += -0.046088; scores[3] += 0.024472; break;
      case 1: scores[0] += -0.000410; scores[1] += 0.027695; scores[2] += -0.000924; scores[3] += -0.026361; break;
      case 2: scores[0] += 0.022944; scores[1] += -0.064800; scores[2] += 0.024877; scores[3] += 0.016979; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.007446; scores[1] += 0.074841; scores[2] += -0.004749; scores[3] += -0.062645; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.016940; scores[1] += -0.016080; scores[2] += -0.008154; scores[3] += 0.041174; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 71 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.026671409606933594) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.063833; scores[1] += 0.010036; scores[2] += 0.030880; scores[3] += 0.022917; break;
      case 1: scores[0] += -0.000514; scores[1] += -0.001449; scores[2] += 0.057178; scores[3] += -0.055216; break;
      case 2: scores[0] += -0.037073; scores[1] += 0.053302; scores[2] += -0.050059; scores[3] += 0.033830; break;
      case 3: scores[0] += -0.000360; scores[1] += -0.002531; scores[2] += -0.002183; scores[3] += 0.005074; break;
      case 4: scores[0] += 0.076890; scores[1] += -0.020656; scores[2] += -0.010329; scores[3] += -0.045905; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.030722; scores[1] += 0.001195; scores[2] += -0.015254; scores[3] += 0.044782; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 72 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[11] > 0.023532669991254807) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.014430; scores[1] += 0.032427; scores[2] += -0.044092; scores[3] += 0.026095; break;
      case 1: scores[0] += 0.012519; scores[1] += 0.038595; scores[2] += -0.007299; scores[3] += -0.043816; break;
      case 2: scores[0] += 0.022150; scores[1] += -0.065000; scores[2] += 0.025068; scores[3] += 0.017783; break;
      case 3: scores[0] += -0.000432; scores[1] += 0.011280; scores[2] += -0.000549; scores[3] += -0.010299; break;
      case 4: scores[0] += -0.006614; scores[1] += 0.068725; scores[2] += -0.004190; scores[3] += -0.057921; break;
      case 5: scores[0] += -0.000761; scores[1] += 0.005683; scores[2] += -0.000421; scores[3] += -0.004501; break;
      case 6: scores[0] += -0.015904; scores[1] += -0.015302; scores[2] += -0.007481; scores[3] += 0.038687; break;
      case 7: scores[0] += -0.000089; scores[1] += 0.001145; scores[2] += -0.000215; scores[3] += -0.000841; break;
    }
  }

  // Tree 73 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[40] > 0.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.017351; scores[1] += -0.019326; scores[2] += 0.020112; scores[3] += -0.018137; break;
      case 1: scores[0] += -0.005132; scores[1] += -0.005261; scores[2] += 0.061287; scores[3] += -0.050894; break;
      case 2: scores[0] += -0.001764; scores[1] += -0.013728; scores[2] += 0.007033; scores[3] += 0.008458; break;
      case 3: scores[0] += -0.008553; scores[1] += -0.007416; scores[2] += -0.031136; scores[3] += 0.047105; break;
      case 4: scores[0] += -0.037333; scores[1] += 0.033171; scores[2] += -0.037558; scores[3] += 0.041721; break;
      case 5: scores[0] += -0.004062; scores[1] += -0.026695; scores[2] += -0.018152; scores[3] += 0.048910; break;
      case 6: scores[0] += -0.029900; scores[1] += 0.065772; scores[2] += -0.038545; scores[3] += 0.002673; break;
      case 7: scores[0] += -0.002435; scores[1] += -0.025925; scores[2] += -0.012721; scores[3] += 0.041081; break;
    }
  }

  // Tree 74 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.032196; scores[1] += -0.073216; scores[2] += 0.028156; scores[3] += 0.012865; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.043309; scores[1] += 0.058161; scores[2] += -0.048476; scores[3] += 0.033624; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.041023; scores[1] += 0.119256; scores[2] += -0.042198; scores[3] += -0.036035; break;
      case 5: scores[0] += -0.000528; scores[1] += -0.001365; scores[2] += 0.054662; scores[3] += -0.052770; break;
      case 6: scores[0] += -0.007801; scores[1] += -0.039671; scores[2] += -0.011410; scores[3] += 0.058882; break;
      case 7: scores[0] += -0.000344; scores[1] += -0.002170; scores[2] += -0.002061; scores[3] += 0.004575; break;
    }
  }

  // Tree 75 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[0] > 0.5) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.013400; scores[1] += 0.020449; scores[2] += -0.025534; scores[3] += 0.018485; break;
      case 1: scores[0] += -0.000233; scores[1] += -0.001773; scores[2] += -0.001178; scores[3] += 0.003184; break;
      case 2: scores[0] += 0.028678; scores[1] += -0.066883; scores[2] += 0.019982; scores[3] += 0.018223; break;
      case 3: scores[0] += -0.000701; scores[1] += -0.002002; scores[2] += 0.051672; scores[3] += -0.048970; break;
      case 4: scores[0] += -0.006141; scores[1] += 0.066087; scores[2] += -0.004143; scores[3] += -0.055803; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.011360; scores[1] += -0.032059; scores[2] += -0.004882; scores[3] += 0.048301; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 76 (depth=3)
  {
    const leafIdx = ((features[13] > 0.4558441638946533) << 0) | ((features[10] > 5.449999809265137) << 1) | ((features[43] > 0.1639784872531891) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.015354; scores[1] += 0.044786; scores[2] += 0.000242; scores[3] += -0.029675; break;
      case 1: scores[0] += -0.000946; scores[1] += 0.046096; scores[2] += -0.000924; scores[3] += -0.044226; break;
      case 2: scores[0] += 0.003117; scores[1] += 0.004607; scores[2] += -0.003158; scores[3] += -0.004566; break;
      case 3: scores[0] += -0.023289; scores[1] += 0.004405; scores[2] += -0.018591; scores[3] += 0.037475; break;
      case 4: scores[0] += -0.001541; scores[1] += -0.016459; scores[2] += -0.003886; scores[3] += 0.021885; break;
      case 5: scores[0] += -0.004156; scores[1] += -0.035511; scores[2] += -0.002642; scores[3] += 0.042309; break;
      case 6: scores[0] += -0.020497; scores[1] += 0.015912; scores[2] += -0.013806; scores[3] += 0.018391; break;
      case 7: scores[0] += -0.008816; scores[1] += -0.026429; scores[2] += -0.004860; scores[3] += 0.040106; break;
    }
  }

  // Tree 77 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.016660; scores[1] += -0.012311; scores[2] += -0.007929; scores[3] += 0.003579; break;
      case 1: scores[0] += -0.000547; scores[1] += -0.001437; scores[2] += 0.051679; scores[3] += -0.049696; break;
      case 2: scores[0] += -0.040295; scores[1] += 0.048098; scores[2] += -0.044277; scores[3] += 0.036474; break;
      case 3: scores[0] += -0.000349; scores[1] += -0.002257; scores[2] += -0.002155; scores[3] += 0.004762; break;
      case 4: scores[0] += -0.008536; scores[1] += 0.013512; scores[2] += 0.083765; scores[3] += -0.088741; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.006490; scores[1] += -0.031184; scores[2] += -0.015097; scores[3] += 0.052771; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 78 (depth=3)
  {
    const leafIdx = ((features[10] > 6.224999904632568) << 0) | ((features[43] > 0.10818713903427124) << 1) | ((features[30] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.040586; scores[1] += 0.030348; scores[2] += 0.012528; scores[3] += -0.002290; break;
      case 1: scores[0] += -0.010843; scores[1] += -0.041802; scores[2] += 0.031393; scores[3] += 0.021252; break;
      case 2: scores[0] += -0.002556; scores[1] += -0.005462; scores[2] += -0.005662; scores[3] += 0.013680; break;
      case 3: scores[0] += -0.014144; scores[1] += 0.041235; scores[2] += -0.011571; scores[3] += -0.015520; break;
      case 4: scores[0] += -0.002950; scores[1] += 0.129909; scores[2] += -0.002811; scores[3] += -0.124149; break;
      case 5: scores[0] += 0.011241; scores[1] += 0.102409; scores[2] += -0.087556; scores[3] += -0.026094; break;
      case 6: scores[0] += -0.003857; scores[1] += -0.041009; scores[2] += -0.002384; scores[3] += 0.047250; break;
      case 7: scores[0] += -0.011055; scores[1] += -0.038019; scores[2] += -0.005791; scores[3] += 0.054864; break;
    }
  }

  // Tree 79 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.071376; scores[1] += -0.018866; scores[2] += -0.009154; scores[3] += -0.043357; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.026490; scores[1] += -0.002811; scores[2] += -0.011576; scores[3] += 0.040877; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.063318; scores[1] += 0.012622; scores[2] += 0.028350; scores[3] += 0.022345; break;
      case 5: scores[0] += -0.000529; scores[1] += -0.001491; scores[2] += 0.050002; scores[3] += -0.047983; break;
      case 6: scores[0] += -0.032809; scores[1] += 0.048258; scores[2] += -0.047374; scores[3] += 0.031925; break;
      case 7: scores[0] += -0.000334; scores[1] += -0.002312; scores[2] += -0.002170; scores[3] += 0.004817; break;
    }
  }

  // Tree 80 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[41] > 0.5) << 1) | ((features[10] > 6.449999809265137) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.045633; scores[1] += 0.035431; scores[2] += 0.022066; scores[3] += -0.011864; break;
      case 1: scores[0] += -0.007334; scores[1] += 0.026738; scores[2] += -0.022986; scores[3] += 0.003581; break;
      case 2: scores[0] += -0.004026; scores[1] += -0.032163; scores[2] += -0.002342; scores[3] += 0.038532; break;
      case 3: scores[0] += -0.000083; scores[1] += -0.004338; scores[2] += -0.000052; scores[3] += 0.004473; break;
      case 4: scores[0] += 0.012830; scores[1] += -0.003804; scores[2] += 0.002327; scores[3] += -0.011353; break;
      case 5: scores[0] += -0.020755; scores[1] += 0.002213; scores[2] += -0.037362; scores[3] += 0.055904; break;
      case 6: scores[0] += -0.012316; scores[1] += -0.036441; scores[2] += -0.005976; scores[3] += 0.054734; break;
      case 7: scores[0] += -0.000867; scores[1] += -0.019356; scores[2] += -0.000611; scores[3] += 0.020834; break;
    }
  }

  // Tree 81 (depth=3)
  {
    const leafIdx = ((features[11] > 0.04396135360002518) << 0) | ((features[26] > 0.5) << 1) | ((features[13] > 0.3015151619911194) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.013386; scores[1] += 0.023219; scores[2] += -0.006355; scores[3] += -0.003478; break;
      case 1: scores[0] += 0.025012; scores[1] += -0.056109; scores[2] += 0.016416; scores[3] += 0.014680; break;
      case 2: scores[0] += -0.002303; scores[1] += 0.075287; scores[2] += -0.001528; scores[3] += -0.071456; break;
      case 3: scores[0] += -0.009541; scores[1] += -0.012904; scores[2] += -0.003686; scores[3] += 0.026131; break;
      case 4: scores[0] += -0.021107; scores[1] += 0.010123; scores[2] += -0.018920; scores[3] += 0.029904; break;
      case 5: scores[0] += -0.015959; scores[1] += -0.023354; scores[2] += -0.010341; scores[3] += 0.049653; break;
      case 6: scores[0] += -0.003740; scores[1] += 0.010983; scores[2] += -0.002050; scores[3] += -0.005192; break;
      case 7: scores[0] += -0.004496; scores[1] += -0.008777; scores[2] += -0.002430; scores[3] += 0.015703; break;
    }
  }

  // Tree 82 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.010204081423580647) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.068350; scores[1] += -0.018843; scores[2] += -0.008671; scores[3] += -0.040835; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.025753; scores[1] += -0.001509; scores[2] += -0.011064; scores[3] += 0.038326; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.061869; scores[1] += 0.011249; scores[2] += 0.027909; scores[3] += 0.022711; break;
      case 5: scores[0] += -0.000515; scores[1] += -0.001448; scores[2] += 0.047990; scores[3] += -0.046028; break;
      case 6: scores[0] += -0.031433; scores[1] += 0.046946; scores[2] += -0.046586; scores[3] += 0.031073; break;
      case 7: scores[0] += -0.000312; scores[1] += -0.002337; scores[2] += -0.002173; scores[3] += 0.004822; break;
    }
  }

  // Tree 83 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[10] > 5.224999904632568) << 1) | ((features[43] > 0.14039409160614014) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008227; scores[1] += 0.049722; scores[2] += -0.020162; scores[3] += -0.021333; break;
      case 1: scores[0] += -0.000438; scores[1] += -0.021298; scores[2] += -0.000696; scores[3] += 0.022432; break;
      case 2: scores[0] += -0.000324; scores[1] += -0.001611; scores[2] += 0.001763; scores[3] += 0.000172; break;
      case 3: scores[0] += -0.006052; scores[1] += 0.034139; scores[2] += -0.007081; scores[3] += -0.021006; break;
      case 4: scores[0] += -0.003535; scores[1] += -0.030671; scores[2] += -0.003397; scores[3] += 0.037604; break;
      case 5: scores[0] += -0.000075; scores[1] += 0.004444; scores[2] += -0.000327; scores[3] += -0.004042; break;
      case 6: scores[0] += -0.018947; scores[1] += -0.001162; scores[2] += -0.012906; scores[3] += 0.033016; break;
      case 7: scores[0] += -0.001154; scores[1] += 0.032264; scores[2] += -0.001109; scores[3] += -0.030001; break;
    }
  }

  // Tree 84 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.018570; scores[1] += 0.009924; scores[2] += -0.035246; scores[3] += 0.006752; break;
      case 1: scores[0] += -0.020919; scores[1] += 0.001392; scores[2] += -0.030228; scores[3] += 0.049756; break;
      case 2: scores[0] += -0.027589; scores[1] += -0.006348; scores[2] += 0.051270; scores[3] += -0.017333; break;
      case 3: scores[0] += -0.001895; scores[1] += -0.014485; scores[2] += -0.027608; scores[3] += 0.043988; break;
      case 4: scores[0] += -0.011478; scores[1] += 0.036219; scores[2] += -0.030070; scores[3] += 0.005328; break;
      case 5: scores[0] += -0.001091; scores[1] += 0.062102; scores[2] += -0.002990; scores[3] += -0.058021; break;
      case 6: scores[0] += -0.009683; scores[1] += -0.017403; scores[2] += -0.016364; scores[3] += 0.043450; break;
      case 7: scores[0] += -0.003566; scores[1] += -0.005708; scores[2] += -0.029630; scores[3] += 0.038905; break;
    }
  }

  // Tree 85 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[10] > 6.633333206176758) << 1) | ((features[43] > 0.18301436305046082) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.047759; scores[1] += 0.043449; scores[2] += 0.011848; scores[3] += -0.007538; break;
      case 1: scores[0] += -0.001217; scores[1] += 0.024969; scores[2] += -0.001721; scores[3] += -0.022030; break;
      case 2: scores[0] += 0.012040; scores[1] += -0.017769; scores[2] += -0.000678; scores[3] += 0.006407; break;
      case 3: scores[0] += 0.011329; scores[1] += 0.030318; scores[2] += -0.005491; scores[3] += -0.036157; break;
      case 4: scores[0] += -0.005048; scores[1] += -0.027094; scores[2] += -0.005914; scores[3] += 0.038056; break;
      case 5: scores[0] += -0.000048; scores[1] += 0.000857; scores[2] += -0.000130; scores[3] += -0.000678; break;
      case 6: scores[0] += -0.017037; scores[1] += 0.004779; scores[2] += -0.009590; scores[3] += 0.021848; break;
      case 7: scores[0] += -0.000452; scores[1] += 0.004112; scores[2] += -0.000238; scores[3] += -0.003422; break;
    }
  }

  // Tree 86 (depth=3)
  {
    const leafIdx = ((features[5] > 0.5) << 0) | ((features[24] > 0.5) << 1) | ((features[34] > 0.550000011920929) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.007161; scores[1] += 0.003917; scores[2] += -0.001031; scores[3] += 0.004275; break;
      case 1: scores[0] += 0.024869; scores[1] += -0.001389; scores[2] += -0.000936; scores[3] += -0.022544; break;
      case 2: scores[0] += -0.000216; scores[1] += 0.023002; scores[2] += -0.000665; scores[3] += -0.022121; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000869; scores[1] += -0.004788; scores[2] += 0.044293; scores[3] += -0.038637; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 87 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[1] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012153; scores[1] += 0.014080; scores[2] += -0.041530; scores[3] += 0.015297; break;
      case 1: scores[0] += -0.000215; scores[1] += 0.022492; scores[2] += -0.000660; scores[3] += -0.021618; break;
      case 2: scores[0] += 0.010270; scores[1] += 0.038101; scores[2] += -0.006486; scores[3] += -0.041885; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.032551; scores[1] += -0.013534; scores[2] += 0.033586; scores[3] += 0.012499; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000091; scores[1] += 0.001232; scores[2] += -0.000206; scores[3] += -0.000935; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 88 (depth=3)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.022885; scores[1] += 0.014913; scores[2] += -0.009923; scores[3] += 0.017895; break;
      case 1: scores[0] += -0.006941; scores[1] += 0.006082; scores[2] += -0.032155; scores[3] += 0.033014; break;
      case 2: scores[0] += -0.010535; scores[1] += 0.030628; scores[2] += -0.006997; scores[3] += -0.013096; break;
      case 3: scores[0] += -0.000876; scores[1] += 0.157400; scores[2] += -0.000510; scores[3] += -0.156013; break;
      case 4: scores[0] += 0.033384; scores[1] += -0.030437; scores[2] += 0.029428; scores[3] += -0.032375; break;
      case 5: scores[0] += -0.013409; scores[1] += -0.017015; scores[2] += -0.038060; scores[3] += 0.068485; break;
      case 6: scores[0] += -0.019072; scores[1] += -0.011653; scores[2] += -0.020118; scores[3] += 0.050843; break;
      case 7: scores[0] += -0.011468; scores[1] += -0.005743; scores[2] += -0.014407; scores[3] += 0.031619; break;
    }
  }

  // Tree 89 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[17] > 0.5) << 1) | ((features[11] > 0.024695120751857758) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.012081; scores[1] += 0.037543; scores[2] += -0.042595; scores[3] += 0.017132; break;
      case 1: scores[0] += 0.021636; scores[1] += -0.002185; scores[2] += -0.000373; scores[3] += -0.019078; break;
      case 2: scores[0] += -0.000833; scores[1] += -0.014148; scores[2] += -0.001319; scores[3] += 0.016300; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.014327; scores[1] += -0.053730; scores[2] += 0.018871; scores[3] += 0.020532; break;
      case 5: scores[0] += 0.014240; scores[1] += -0.000423; scores[2] += -0.000621; scores[3] += -0.013197; break;
      case 6: scores[0] += -0.002478; scores[1] += -0.005760; scores[2] += 0.060636; scores[3] += -0.052397; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 90 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[35] > 0.5) << 1) | ((features[33] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008273; scores[1] += -0.021992; scores[2] += 0.027224; scores[3] += -0.013505; break;
      case 1: scores[0] += -0.004845; scores[1] += 0.040086; scores[2] += -0.005670; scores[3] += -0.029571; break;
      case 2: scores[0] += -0.012250; scores[1] += 0.016555; scores[2] += -0.052340; scores[3] += 0.048035; break;
      case 3: scores[0] += -0.001694; scores[1] += -0.015048; scores[2] += -0.001858; scores[3] += 0.018600; break;
      case 4: scores[0] += -0.029474; scores[1] += 0.034096; scores[2] += -0.030010; scores[3] += 0.025388; break;
      case 5: scores[0] += -0.000212; scores[1] += 0.014673; scores[2] += -0.000112; scores[3] += -0.014349; break;
      case 6: scores[0] += -0.028349; scores[1] += 0.144465; scores[2] += -0.035415; scores[3] += -0.080700; break;
      case 7: scores[0] += -0.000040; scores[1] += 0.006830; scores[2] += -0.000024; scores[3] += -0.006767; break;
    }
  }

  // Tree 91 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[13] > 0.8591269850730896) << 1) | ((features[33] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001833; scores[1] += -0.003306; scores[2] += 0.002253; scores[3] += -0.000780; break;
      case 1: scores[0] += 0.029177; scores[1] += -0.002497; scores[2] += -0.000931; scores[3] += -0.025749; break;
      case 2: scores[0] += -0.010150; scores[1] += -0.036804; scores[2] += -0.003685; scores[3] += 0.050639; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.051877; scores[1] += 0.132515; scores[2] += -0.056119; scores[3] += -0.024519; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.003924; scores[1] += -0.038547; scores[2] += -0.002627; scores[3] += 0.045099; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 92 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[0] > 0.5) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008247; scores[1] += 0.013674; scores[2] += -0.017290; scores[3] += 0.011862; break;
      case 1: scores[0] += -0.000182; scores[1] += -0.001851; scores[2] += -0.001267; scores[3] += 0.003301; break;
      case 2: scores[0] += 0.024040; scores[1] += -0.062670; scores[2] += 0.018344; scores[3] += 0.020285; break;
      case 3: scores[0] += -0.000608; scores[1] += -0.001812; scores[2] += 0.042297; scores[3] += -0.039877; break;
      case 4: scores[0] += -0.004303; scores[1] += 0.057899; scores[2] += -0.002826; scores[3] += -0.050770; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.008639; scores[1] += -0.030059; scores[2] += -0.003481; scores[3] += 0.042178; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 93 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.15894736349582672) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.063546; scores[1] += -0.015522; scores[2] += -0.008248; scores[3] += -0.039777; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.023888; scores[1] += -0.001321; scores[2] += -0.009172; scores[3] += 0.034381; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.062682; scores[1] += 0.026732; scores[2] += 0.016995; scores[3] += 0.018954; break;
      case 5: scores[0] += -0.000612; scores[1] += -0.001824; scores[2] += 0.040936; scores[3] += -0.038500; break;
      case 6: scores[0] += -0.025033; scores[1] += 0.025739; scores[2] += -0.025857; scores[3] += 0.025152; break;
      case 7: scores[0] += -0.000182; scores[1] += -0.001842; scores[2] += -0.001262; scores[3] += 0.003286; break;
    }
  }

  // Tree 94 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[10] > 6.449999809265137) << 1) | ((features[43] > 0.17028985917568207) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.040360; scores[1] += 0.037528; scores[2] += 0.011906; scores[3] += -0.009074; break;
      case 1: scores[0] += -0.000178; scores[1] += 0.022034; scores[2] += -0.000557; scores[3] += -0.021299; break;
      case 2: scores[0] += 0.011073; scores[1] += -0.012384; scores[2] += -0.002445; scores[3] += 0.003755; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.004090; scores[1] += -0.026805; scores[2] += -0.004949; scores[3] += 0.035844; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.016421; scores[1] += 0.006505; scores[2] += -0.009581; scores[3] += 0.019497; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 95 (depth=3)
  {
    const leafIdx = ((features[13] > 0.4082491397857666) << 0) | ((features[14] > 0.5) << 1) | ((features[43] > 0.13188406825065613) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006058; scores[1] += -0.009871; scores[2] += 0.002557; scores[3] += 0.001256; break;
      case 1: scores[0] += -0.006482; scores[1] += -0.039574; scores[2] += -0.006541; scores[3] += 0.052597; break;
      case 2: scores[0] += -0.009271; scores[1] += 0.131626; scores[2] += -0.006970; scores[3] += -0.115386; break;
      case 3: scores[0] += -0.018894; scores[1] += 0.027640; scores[2] += -0.012465; scores[3] += 0.003718; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.015579; scores[1] += 0.015195; scores[2] += -0.011818; scores[3] += 0.012201; break;
      case 7: scores[0] += -0.007766; scores[1] += -0.026765; scores[2] += -0.004326; scores[3] += 0.038858; break;
    }
  }

  // Tree 96 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[11] > 0.033908046782016754) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005853; scores[1] += 0.016309; scores[2] += -0.020774; scores[3] += 0.010318; break;
      case 1: scores[0] += -0.000173; scores[1] += -0.001854; scores[2] += -0.001265; scores[3] += 0.003292; break;
      case 2: scores[0] += 0.017831; scores[1] += -0.054455; scores[2] += 0.017627; scores[3] += 0.018998; break;
      case 3: scores[0] += -0.000593; scores[1] += -0.001883; scores[2] += 0.039250; scores[3] += -0.036774; break;
      case 4: scores[0] += -0.003698; scores[1] += 0.048947; scores[2] += -0.002231; scores[3] += -0.043017; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.010151; scores[1] += -0.008552; scores[2] += -0.004513; scores[3] += 0.023216; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 97 (depth=3)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.020901; scores[1] += 0.012952; scores[2] += -0.007893; scores[3] += 0.015842; break;
      case 1: scores[0] += -0.003336; scores[1] += 0.004457; scores[2] += -0.029389; scores[3] += 0.028268; break;
      case 2: scores[0] += -0.008646; scores[1] += 0.027870; scores[2] += -0.005614; scores[3] += -0.013610; break;
      case 3: scores[0] += -0.000559; scores[1] += 0.098712; scores[2] += -0.000304; scores[3] += -0.097849; break;
      case 4: scores[0] += 0.029330; scores[1] += -0.022107; scores[2] += 0.021405; scores[3] += -0.028628; break;
      case 5: scores[0] += -0.012429; scores[1] += -0.015086; scores[2] += -0.037276; scores[3] += 0.064790; break;
      case 6: scores[0] += -0.017053; scores[1] += -0.012842; scores[2] += -0.018677; scores[3] += 0.048572; break;
      case 7: scores[0] += -0.010705; scores[1] += -0.006314; scores[2] += -0.014019; scores[3] += 0.031038; break;
    }
  }

  // Tree 98 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[11] > 0.024695120751857758) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002294; scores[1] += 0.021688; scores[2] += -0.038550; scores[3] += 0.014568; break;
      case 1: scores[0] += -0.004724; scores[1] += 0.017223; scores[2] += -0.004587; scores[3] += -0.007913; break;
      case 2: scores[0] += -0.003128; scores[1] += 0.036450; scores[2] += -0.007536; scores[3] += -0.025786; break;
      case 3: scores[0] += -0.000370; scores[1] += 0.030211; scores[2] += -0.000420; scores[3] += -0.029422; break;
      case 4: scores[0] += 0.012454; scores[1] += -0.061228; scores[2] += 0.038623; scores[3] += 0.010151; break;
      case 5: scores[0] += -0.001053; scores[1] += 0.009324; scores[2] += -0.002172; scores[3] += -0.006099; break;
      case 6: scores[0] += -0.012476; scores[1] += -0.013125; scores[2] += -0.024006; scores[3] += 0.049607; break;
      case 7: scores[0] += -0.000018; scores[1] += 0.004147; scores[2] += -0.000023; scores[3] += -0.004106; break;
    }
  }

  // Tree 99 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.029756; scores[1] += -0.069173; scores[2] += 0.022883; scores[3] += 0.016534; break;
      case 1: scores[0] += -0.001161; scores[1] += -0.001106; scores[2] += 0.047954; scores[3] += -0.045687; break;
      case 2: scores[0] += -0.035817; scores[1] += 0.054230; scores[2] += -0.046809; scores[3] += 0.028396; break;
      case 3: scores[0] += -0.000812; scores[1] += -0.011456; scores[2] += -0.001221; scores[3] += 0.013489; break;
      case 4: scores[0] += -0.030091; scores[1] += 0.104418; scores[2] += -0.035003; scores[3] += -0.039325; break;
      case 5: scores[0] += -0.000459; scores[1] += -0.002209; scores[2] += 0.021010; scores[3] += -0.018342; break;
      case 6: scores[0] += -0.004931; scores[1] += -0.040541; scores[2] += -0.008865; scores[3] += 0.054337; break;
      case 7: scores[0] += -0.000397; scores[1] += -0.003430; scores[2] += -0.000346; scores[3] += 0.004173; break;
    }
  }

  // Tree 100 (depth=3)
  {
    const leafIdx = ((features[41] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.023532669991254807) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008037; scores[1] += 0.007618; scores[2] += -0.035355; scores[3] += 0.019699; break;
      case 1: scores[0] += -0.001826; scores[1] += -0.012996; scores[2] += -0.000526; scores[3] += 0.015348; break;
      case 2: scores[0] += -0.007716; scores[1] += 0.057423; scores[2] += -0.007207; scores[3] += -0.042501; break;
      case 3: scores[0] += -0.004771; scores[1] += -0.038086; scores[2] += -0.002229; scores[3] += 0.045086; break;
      case 4: scores[0] += 0.017698; scores[1] += -0.052206; scores[2] += 0.019821; scores[3] += 0.014686; break;
      case 5: scores[0] += -0.001834; scores[1] += -0.001452; scores[2] += -0.000440; scores[3] += 0.003726; break;
      case 6: scores[0] += -0.013556; scores[1] += -0.014389; scores[2] += -0.010727; scores[3] += 0.038673; break;
      case 7: scores[0] += -0.007047; scores[1] += -0.027097; scores[2] += -0.003075; scores[3] += 0.037219; break;
    }
  }

  // Tree 101 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.3816526532173157) << 1) | ((features[11] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001562; scores[1] += 0.036476; scores[2] += -0.039196; scores[3] += 0.001158; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.013112; scores[1] += -0.002183; scores[2] += -0.010480; scores[3] += 0.025775; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.014166; scores[1] += -0.042546; scores[2] += 0.014810; scores[3] += 0.013570; break;
      case 5: scores[0] += -0.000584; scores[1] += -0.001809; scores[2] += 0.038455; scores[3] += -0.036062; break;
      case 6: scores[0] += -0.011789; scores[1] += -0.026343; scores[2] += -0.007616; scores[3] += 0.045747; break;
      case 7: scores[0] += -0.000149; scores[1] += -0.001491; scores[2] += -0.001091; scores[3] += 0.002731; break;
    }
  }

  // Tree 102 (depth=3)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[22] > 0.5) << 1) | ((features[35] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.011553; scores[1] += -0.019553; scores[2] += 0.028960; scores[3] += -0.020959; break;
      case 1: scores[0] += -0.025447; scores[1] += 0.027594; scores[2] += -0.027275; scores[3] += 0.025128; break;
      case 2: scores[0] += -0.021298; scores[1] += 0.018001; scores[2] += -0.038532; scores[3] += 0.041828; break;
      case 3: scores[0] += -0.000065; scores[1] += 0.050302; scores[2] += -0.000026; scores[3] += -0.050210; break;
      case 4: scores[0] += -0.008045; scores[1] += 0.018877; scores[2] += -0.052390; scores[3] += 0.041559; break;
      case 5: scores[0] += -0.021365; scores[1] += 0.092752; scores[2] += -0.028222; scores[3] += -0.043165; break;
      case 6: scores[0] += -0.005590; scores[1] += -0.011585; scores[2] += -0.027979; scores[3] += 0.045154; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 103 (depth=3)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[9] > 1.5) << 1) | ((features[13] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.058166; scores[1] += -0.017318; scores[2] += -0.007226; scores[3] += -0.033622; break;
      case 1: scores[0] += 0.025550; scores[1] += -0.001088; scores[2] += -0.000171; scores[3] += -0.024292; break;
      case 2: scores[0] += -0.059116; scores[1] += 0.006028; scores[2] += 0.047308; scores[3] += 0.005781; break;
      case 3: scores[0] += -0.025719; scores[1] += 0.021600; scores[2] += -0.046355; scores[3] += 0.050474; break;
      case 4: scores[0] += -0.022233; scores[1] += -0.000499; scores[2] += -0.008230; scores[3] += 0.030962; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.023101; scores[1] += 0.037501; scores[2] += -0.044900; scores[3] += 0.030500; break;
      case 7: scores[0] += -0.007445; scores[1] += 0.020931; scores[2] += -0.007131; scores[3] += -0.006355; break;
    }
  }

  // Tree 104 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[40] > 0.5) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012823; scores[1] += -0.018125; scores[2] += 0.017395; scores[3] += -0.012093; break;
      case 1: scores[0] += -0.003536; scores[1] += -0.002492; scores[2] += 0.031971; scores[3] += -0.025943; break;
      case 2: scores[0] += -0.005148; scores[1] += -0.004325; scores[2] += 0.003752; scores[3] += 0.005721; break;
      case 3: scores[0] += -0.005873; scores[1] += -0.002985; scores[2] += -0.029593; scores[3] += 0.038451; break;
      case 4: scores[0] += -0.028356; scores[1] += 0.027312; scores[2] += -0.031805; scores[3] += 0.032848; break;
      case 5: scores[0] += -0.002377; scores[1] += -0.026272; scores[2] += -0.014886; scores[3] += 0.043535; break;
      case 6: scores[0] += -0.016958; scores[1] += 0.047020; scores[2] += -0.028988; scores[3] += -0.001074; break;
      case 7: scores[0] += -0.001348; scores[1] += -0.025579; scores[2] += -0.009692; scores[3] += 0.036618; break;
    }
  }

  // Tree 105 (depth=3)
  {
    const leafIdx = ((features[20] > 0.5) << 0) | ((features[34] > 0.05000000074505806) << 1) | ((features[13] > 0.025978408753871918) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.021469; scores[1] += -0.050346; scores[2] += -0.005230; scores[3] += 0.034107; break;
      case 1: scores[0] += -0.006072; scores[1] += 0.075873; scores[2] += 0.035031; scores[3] += -0.104832; break;
      case 2: scores[0] += 0.019166; scores[1] += -0.035595; scores[2] += 0.016542; scores[3] += -0.000113; break;
      case 3: scores[0] += -0.013862; scores[1] += -0.023957; scores[2] += 0.004633; scores[3] += 0.033186; break;
      case 4: scores[0] += -0.021389; scores[1] += 0.017120; scores[2] += -0.011891; scores[3] += 0.016159; break;
      case 5: scores[0] += -0.002869; scores[1] += -0.036155; scores[2] += -0.003066; scores[3] += 0.042090; break;
      case 6: scores[0] += -0.026570; scores[1] += 0.053817; scores[2] += -0.045837; scores[3] += 0.018590; break;
      case 7: scores[0] += -0.002498; scores[1] += -0.038708; scores[2] += -0.006457; scores[3] += 0.047663; break;
    }
  }

  // Tree 106 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[1] > 0.5) << 1) | ((features[43] > 0.1889880895614624) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004907; scores[1] += 0.008563; scores[2] += -0.002541; scores[3] += -0.001115; break;
      case 1: scores[0] += -0.000138; scores[1] += 0.018598; scores[2] += -0.000397; scores[3] += -0.018063; break;
      case 2: scores[0] += 0.007753; scores[1] += 0.033945; scores[2] += -0.005377; scores[3] += -0.036321; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.011904; scores[1] += -0.009951; scores[2] += -0.008063; scores[3] += 0.029918; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000263; scores[1] += 0.003283; scores[2] += -0.000204; scores[3] += -0.002817; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 107 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[10] > 13.833333969116211) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.019599; scores[1] += 0.001647; scores[2] += 0.007910; scores[3] += 0.010042; break;
      case 1: scores[0] += 0.001273; scores[1] += 0.035945; scores[2] += -0.004658; scores[3] += -0.032560; break;
      case 2: scores[0] += -0.002285; scores[1] += 0.053894; scores[2] += -0.001463; scores[3] += -0.050147; break;
      case 3: scores[0] += -0.000053; scores[1] += 0.001026; scores[2] += -0.000123; scores[3] += -0.000850; break;
      case 4: scores[0] += 0.049308; scores[1] += -0.035190; scores[2] += -0.008262; scores[3] += -0.005856; break;
      case 5: scores[0] += 0.007728; scores[1] += -0.002911; scores[2] += -0.000507; scores[3] += -0.004310; break;
      case 6: scores[0] += -0.007423; scores[1] += -0.015546; scores[2] += -0.003141; scores[3] += 0.026111; break;
      case 7: scores[0] += -0.000212; scores[1] += 0.002316; scores[2] += -0.000083; scores[3] += -0.002021; break;
    }
  }

  // Tree 108 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[24] > 0.5) << 1) | ((features[13] > 0.3973684310913086) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.006882; scores[1] += 0.015059; scores[2] += -0.004254; scores[3] += -0.003924; break;
      case 1: scores[0] += 0.025455; scores[1] += -0.001994; scores[2] += -0.000782; scores[3] += -0.022679; break;
      case 2: scores[0] += -0.000134; scores[1] += 0.018311; scores[2] += -0.000395; scores[3] += -0.017781; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.018272; scores[1] += -0.003314; scores[2] += -0.013368; scores[3] += 0.034955; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 109 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000140; scores[1] += -0.009484; scores[2] += -0.000517; scores[3] += 0.010141; break;
      case 1: scores[0] += -0.004634; scores[1] += 0.005669; scores[2] += -0.005046; scores[3] += 0.004011; break;
      case 2: scores[0] += -0.003139; scores[1] += 0.027283; scores[2] += -0.006615; scores[3] += -0.017528; break;
      case 3: scores[0] += -0.000320; scores[1] += 0.028029; scores[2] += -0.000386; scores[3] += -0.027323; break;
      case 4: scores[0] += -0.002217; scores[1] += 0.001265; scores[2] += 0.012535; scores[3] += -0.011582; break;
      case 5: scores[0] += -0.000275; scores[1] += 0.030772; scores[2] += -0.000598; scores[3] += -0.029899; break;
      case 6: scores[0] += -0.011919; scores[1] += -0.000659; scores[2] += -0.029354; scores[3] += 0.041932; break;
      case 7: scores[0] += -0.000028; scores[1] += 0.008196; scores[2] += -0.000026; scores[3] += -0.008142; break;
    }
  }

  // Tree 110 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[11] > 0.18019481003284454) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005069; scores[1] += 0.000245; scores[2] += 0.007691; scores[3] += -0.002867; break;
      case 1: scores[0] += -0.000133; scores[1] += 0.018145; scores[2] += -0.000393; scores[3] += -0.017618; break;
      case 2: scores[0] += -0.009483; scores[1] += -0.037862; scores[2] += 0.008760; scores[3] += 0.038585; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.004555; scores[1] += 0.026438; scores[2] += -0.020960; scores[3] += -0.010033; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000512; scores[1] += -0.000231; scores[2] += -0.022255; scores[3] += 0.022998; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 111 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025978408753871918) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009935; scores[1] += -0.009803; scores[2] += -0.000714; scores[3] += 0.000582; break;
      case 1: scores[0] += -0.000378; scores[1] += -0.001146; scores[2] += 0.039003; scores[3] += -0.037478; break;
      case 2: scores[0] += -0.030708; scores[1] += 0.039552; scores[2] += -0.041199; scores[3] += 0.032356; break;
      case 3: scores[0] += -0.000187; scores[1] += -0.001440; scores[2] += -0.001886; scores[3] += 0.003513; break;
      case 4: scores[0] += -0.001090; scores[1] += -0.001003; scores[2] += 0.051158; scores[3] += -0.049065; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000786; scores[1] += -0.021271; scores[2] += -0.001870; scores[3] += 0.023926; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 112 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012843; scores[1] += -0.008397; scores[2] += -0.008864; scores[3] += 0.004418; break;
      case 1: scores[0] += -0.000377; scores[1] += -0.001141; scores[2] += 0.037831; scores[3] += -0.036312; break;
      case 2: scores[0] += -0.029745; scores[1] += 0.039888; scores[2] += -0.039475; scores[3] += 0.029331; break;
      case 3: scores[0] += -0.000186; scores[1] += -0.001433; scores[2] += -0.001877; scores[3] += 0.003496; break;
      case 4: scores[0] += -0.005123; scores[1] += 0.005370; scores[2] += 0.082553; scores[3] += -0.082800; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.003656; scores[1] += -0.031831; scores[2] += -0.011032; scores[3] += 0.046519; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 113 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[36] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007087; scores[1] += 0.014216; scores[2] += -0.032710; scores[3] += 0.011407; break;
      case 1: scores[0] += 0.024718; scores[1] += -0.001907; scores[2] += -0.000762; scores[3] += -0.022050; break;
      case 2: scores[0] += -0.001170; scores[1] += -0.023305; scores[2] += -0.001055; scores[3] += 0.025530; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.025582; scores[1] += -0.002080; scores[2] += 0.027540; scores[3] += 0.000122; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.006013; scores[1] += -0.018958; scores[2] += -0.012029; scores[3] += 0.036999; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 114 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[31] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.019831; scores[1] += -0.009190; scores[2] += -0.006629; scores[3] += -0.004012; break;
      case 1: scores[0] += -0.019159; scores[1] += 0.012378; scores[2] += -0.035198; scores[3] += 0.041979; break;
      case 2: scores[0] += -0.039027; scores[1] += 0.100189; scores[2] += -0.047258; scores[3] += -0.013904; break;
      case 3: scores[0] += -0.000046; scores[1] += 0.048003; scores[2] += -0.000018; scores[3] += -0.047938; break;
      case 4: scores[0] += -0.021181; scores[1] += 0.000419; scores[2] += 0.027013; scores[3] += -0.006251; break;
      case 5: scores[0] += -0.001334; scores[1] += -0.012569; scores[2] += -0.027225; scores[3] += 0.041128; break;
      case 6: scores[0] += -0.004427; scores[1] += -0.027783; scores[2] += -0.002680; scores[3] += 0.034890; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 115 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[34] > 0.550000011920929) << 1) | ((features[13] > 0.34428879618644714) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002254; scores[1] += 0.014691; scores[2] += -0.007420; scores[3] += -0.005016; break;
      case 1: scores[0] += -0.000131; scores[1] += 0.018258; scores[2] += -0.000353; scores[3] += -0.017773; break;
      case 2: scores[0] += -0.000441; scores[1] += -0.001497; scores[2] += 0.034387; scores[3] += -0.032449; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.018400; scores[1] += 0.000889; scores[2] += -0.013374; scores[3] += 0.030885; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000109; scores[1] += -0.001152; scores[2] += -0.000897; scores[3] += 0.002158; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 116 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[13] > 0.31909090280532837) << 1) | ((features[10] > 4.7083330154418945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002478; scores[1] += 0.019619; scores[2] += -0.001148; scores[3] += -0.020949; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.001208; scores[1] += -0.008195; scores[2] += -0.000704; scores[3] += 0.010108; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.002742; scores[1] += 0.008809; scores[2] += -0.002632; scores[3] += -0.003436; break;
      case 5: scores[0] += 0.007552; scores[1] += 0.026027; scores[2] += -0.005145; scores[3] += -0.028434; break;
      case 6: scores[0] += -0.018824; scores[1] += 0.003179; scores[2] += -0.013734; scores[3] += 0.029379; break;
      case 7: scores[0] += -0.000216; scores[1] += 0.016624; scores[2] += -0.000144; scores[3] += -0.016265; break;
    }
  }

  // Tree 117 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.07362240552902222) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009841; scores[1] += -0.005977; scores[2] += 0.011315; scores[3] += 0.004502; break;
      case 1: scores[0] += -0.006453; scores[1] += -0.003188; scores[2] += -0.023492; scores[3] += 0.033133; break;
      case 2: scores[0] += 0.020235; scores[1] += -0.014462; scores[2] += 0.017674; scores[3] += -0.023447; break;
      case 3: scores[0] += -0.002115; scores[1] += -0.001975; scores[2] += 0.035115; scores[3] += -0.031025; break;
      case 4: scores[0] += -0.020619; scores[1] += 0.026976; scores[2] += -0.016248; scores[3] += 0.009890; break;
      case 5: scores[0] += -0.001719; scores[1] += -0.032014; scores[2] += -0.010282; scores[3] += 0.044016; break;
      case 6: scores[0] += -0.016723; scores[1] += 0.004681; scores[2] += -0.027483; scores[3] += 0.039525; break;
      case 7: scores[0] += -0.001164; scores[1] += -0.005197; scores[2] += -0.012743; scores[3] += 0.019104; break;
    }
  }

  // Tree 118 (depth=3)
  {
    const leafIdx = ((features[10] > 6.449999809265137) << 0) | ((features[43] > 0.1775210201740265) << 1) | ((features[30] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.034214; scores[1] += 0.014861; scores[2] += 0.017623; scores[3] += 0.001730; break;
      case 1: scores[0] += 0.001507; scores[1] += -0.038068; scores[2] += 0.020677; scores[3] += 0.015884; break;
      case 2: scores[0] += -0.000863; scores[1] += -0.012426; scores[2] += -0.002153; scores[3] += 0.015442; break;
      case 3: scores[0] += -0.004748; scores[1] += 0.024788; scores[2] += -0.003103; scores[3] += -0.016937; break;
      case 4: scores[0] += -0.000884; scores[1] += 0.077201; scores[2] += -0.000786; scores[3] += -0.075531; break;
      case 5: scores[0] += 0.008534; scores[1] += 0.074263; scores[2] += -0.069717; scores[3] += -0.013080; break;
      case 6: scores[0] += -0.001196; scores[1] += -0.040986; scores[2] += -0.000610; scores[3] += 0.042792; break;
      case 7: scores[0] += -0.003905; scores[1] += -0.039348; scores[2] += -0.001711; scores[3] += 0.044964; break;
    }
  }

  // Tree 119 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012270; scores[1] += 0.003831; scores[2] += -0.026098; scores[3] += 0.009996; break;
      case 1: scores[0] += -0.004683; scores[1] += 0.013416; scores[2] += -0.005053; scores[3] += -0.003680; break;
      case 2: scores[0] += -0.006995; scores[1] += 0.029118; scores[2] += -0.019856; scores[3] += -0.002267; break;
      case 3: scores[0] += -0.000337; scores[1] += 0.031448; scores[2] += -0.000389; scores[3] += -0.030722; break;
      case 4: scores[0] += -0.020349; scores[1] += -0.005496; scores[2] += 0.033358; scores[3] += -0.007513; break;
      case 5: scores[0] += -0.000107; scores[1] += 0.014516; scores[2] += -0.000484; scores[3] += -0.013925; break;
      case 6: scores[0] += -0.008365; scores[1] += -0.012180; scores[2] += -0.024229; scores[3] += 0.044774; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 120 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.011022; scores[1] += -0.007754; scores[2] += -0.008093; scores[3] += 0.004824; break;
      case 1: scores[0] += -0.000555; scores[1] += -0.000379; scores[2] += 0.031936; scores[3] += -0.031002; break;
      case 2: scores[0] += -0.027548; scores[1] += 0.038443; scores[2] += -0.038664; scores[3] += 0.027769; break;
      case 3: scores[0] += -0.000355; scores[1] += -0.006925; scores[2] += -0.000378; scores[3] += 0.007657; break;
      case 4: scores[0] += -0.004265; scores[1] += 0.006738; scores[2] += 0.075256; scores[3] += -0.077729; break;
      case 5: scores[0] += -0.000802; scores[1] += -0.002795; scores[2] += 0.032097; scores[3] += -0.028501; break;
      case 6: scores[0] += -0.003076; scores[1] += -0.030376; scores[2] += -0.010395; scores[3] += 0.043848; break;
      case 7: scores[0] += -0.000448; scores[1] += -0.006290; scores[2] += -0.000681; scores[3] += 0.007419; break;
    }
  }

  // Tree 121 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[11] > 0.07947368174791336) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.023615; scores[1] += 0.005484; scores[2] += 0.018337; scores[3] += -0.000207; break;
      case 1: scores[0] += 0.021694; scores[1] += -0.001801; scores[2] += -0.000529; scores[3] += -0.019364; break;
      case 2: scores[0] += -0.006667; scores[1] += -0.030439; scores[2] += -0.008160; scores[3] += 0.045265; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.019302; scores[1] += -0.013194; scores[2] += -0.007060; scores[3] += 0.000952; break;
      case 5: scores[0] += 0.004273; scores[1] += -0.000079; scores[2] += -0.000211; scores[3] += -0.003983; break;
      case 6: scores[0] += -0.002588; scores[1] += -0.007802; scores[2] += 0.022026; scores[3] += -0.011635; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 122 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[24] > 0.5) << 1) | ((features[11] > 0.023532669991254807) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004237; scores[1] += 0.024635; scores[2] += -0.032480; scores[3] += 0.012082; break;
      case 1: scores[0] += 0.017644; scores[1] += -0.001702; scores[2] += -0.000278; scores[3] += -0.015664; break;
      case 2: scores[0] += -0.000122; scores[1] += 0.017684; scores[2] += -0.000347; scores[3] += -0.017215; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.008488; scores[1] += -0.046341; scores[2] += 0.020269; scores[3] += 0.017584; break;
      case 5: scores[0] += 0.009415; scores[1] += -0.000177; scores[2] += -0.000476; scores[3] += -0.008762; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 123 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.024597; scores[1] += -0.064539; scores[2] += 0.023635; scores[3] += 0.016307; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.027384; scores[1] += 0.043773; scores[2] += -0.040505; scores[3] += 0.024117; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.024486; scores[1] += 0.093743; scores[2] += -0.034305; scores[3] += -0.034952; break;
      case 5: scores[0] += -0.000323; scores[1] += -0.000999; scores[2] += 0.034142; scores[3] += -0.032821; break;
      case 6: scores[0] += -0.003198; scores[1] += -0.041465; scores[2] += -0.005496; scores[3] += 0.050159; break;
      case 7: scores[0] += -0.000142; scores[1] += -0.001148; scores[2] += -0.001739; scores[3] += 0.003029; break;
    }
  }

  // Tree 124 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.1835016906261444) << 1) | ((features[11] > 0.07229965180158615) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.014928; scores[1] += 0.006715; scores[2] += 0.006958; scores[3] += 0.001255; break;
      case 1: scores[0] += -0.005926; scores[1] += -0.028726; scores[2] += -0.011915; scores[3] += 0.046567; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.017324; scores[1] += -0.034306; scores[2] += 0.017966; scores[3] += -0.000984; break;
      case 5: scores[0] += -0.002921; scores[1] += -0.008649; scores[2] += 0.040253; scores[3] += -0.028683; break;
      case 6: scores[0] += 0.001825; scores[1] += 0.029402; scores[2] += -0.018762; scores[3] += -0.012465; break;
      case 7: scores[0] += -0.000474; scores[1] += -0.000192; scores[2] += -0.024154; scores[3] += 0.024820; break;
    }
  }

  // Tree 125 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[3] > 0.5) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.007259; scores[1] += -0.015856; scores[2] += 0.036191; scores[3] += -0.013076; break;
      case 1: scores[0] += -0.006352; scores[1] += -0.027167; scores[2] += -0.001766; scores[3] += 0.035285; break;
      case 2: scores[0] += -0.002079; scores[1] += 0.044752; scores[2] += -0.029301; scores[3] += -0.013372; break;
      case 3: scores[0] += -0.000493; scores[1] += -0.000903; scores[2] += -0.023554; scores[3] += 0.024949; break;
      case 4: scores[0] += -0.012030; scores[1] += 0.043232; scores[2] += -0.058259; scores[3] += 0.027057; break;
      case 5: scores[0] += -0.002601; scores[1] += -0.024441; scores[2] += 0.025338; scores[3] += 0.001705; break;
      case 6: scores[0] += -0.000191; scores[1] += 0.031618; scores[2] += -0.000815; scores[3] += -0.030612; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 126 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[40] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001378; scores[1] += -0.009335; scores[2] += 0.014127; scores[3] += -0.003415; break;
      case 1: scores[0] += 0.020705; scores[1] += -0.001550; scores[2] += -0.000659; scores[3] += -0.018496; break;
      case 2: scores[0] += -0.004315; scores[1] += -0.033318; scores[2] += 0.032430; scores[3] += 0.005203; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.015268; scores[1] += 0.025032; scores[2] += -0.010146; scores[3] += 0.000382; break;
      case 5: scores[0] += 0.003942; scores[1] += -0.000180; scores[2] += -0.000089; scores[3] += -0.003672; break;
      case 6: scores[0] += -0.004595; scores[1] += -0.017979; scores[2] += -0.021360; scores[3] += 0.043934; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 127 (depth=3)
  {
    const leafIdx = ((features[18] > 0.5) << 0) | ((features[13] > 0.11651583760976791) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006058; scores[1] += 0.009250; scores[2] += -0.014639; scores[3] += -0.000669; break;
      case 1: scores[0] += -0.001116; scores[1] += -0.001058; scores[2] += 0.048280; scores[3] += -0.046107; break;
      case 2: scores[0] += -0.025238; scores[1] += 0.021626; scores[2] += -0.020929; scores[3] += 0.024541; break;
      case 3: scores[0] += -0.000582; scores[1] += -0.019097; scores[2] += -0.001552; scores[3] += 0.021230; break;
      case 4: scores[0] += -0.002174; scores[1] += -0.003990; scores[2] += 0.052476; scores[3] += -0.046312; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001891; scores[1] += -0.028642; scores[2] += -0.001174; scores[3] += 0.031707; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 128 (depth=3)
  {
    const leafIdx = ((features[13] > 0.6120071411132812) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009724; scores[1] += 0.004698; scores[2] += -0.030183; scores[3] += 0.015761; break;
      case 1: scores[0] += -0.001113; scores[1] += -0.015265; scores[2] += -0.000461; scores[3] += 0.016838; break;
      case 2: scores[0] += -0.003721; scores[1] += 0.045740; scores[2] += -0.003330; scores[3] += -0.038689; break;
      case 3: scores[0] += -0.002587; scores[1] += -0.035867; scores[2] += -0.001273; scores[3] += 0.039727; break;
      case 4: scores[0] += 0.013275; scores[1] += -0.046607; scores[2] += 0.018834; scores[3] += 0.014498; break;
      case 5: scores[0] += -0.001149; scores[1] += -0.002170; scores[2] += -0.000340; scores[3] += 0.003659; break;
      case 6: scores[0] += -0.008748; scores[1] += -0.014243; scores[2] += -0.006602; scores[3] += 0.029593; break;
      case 7: scores[0] += -0.004202; scores[1] += -0.026209; scores[2] += -0.001660; scores[3] += 0.032071; break;
    }
  }

  // Tree 129 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[20] > 0.5) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001455; scores[1] += -0.017227; scores[2] += -0.008152; scores[3] += 0.023924; break;
      case 1: scores[0] += 0.020492; scores[1] += -0.001648; scores[2] += -0.000528; scores[3] += -0.018317; break;
      case 2: scores[0] += -0.009795; scores[1] += 0.042342; scores[2] += 0.030179; scores[3] += -0.062726; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.002619; scores[1] += 0.018450; scores[2] += -0.005096; scores[3] += -0.010735; break;
      case 5: scores[0] += 0.003938; scores[1] += -0.000063; scores[2] += -0.000213; scores[3] += -0.003663; break;
      case 6: scores[0] += -0.011608; scores[1] += -0.043365; scores[2] += 0.013385; scores[3] += 0.041587; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 130 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001907; scores[1] += -0.012594; scores[2] += 0.019329; scores[3] += -0.004829; break;
      case 1: scores[0] += -0.003704; scores[1] += 0.014236; scores[2] += -0.003381; scores[3] += -0.007150; break;
      case 2: scores[0] += -0.013045; scores[1] += 0.024664; scores[2] += -0.036777; scores[3] += 0.025157; break;
      case 3: scores[0] += -0.000294; scores[1] += 0.028678; scores[2] += -0.000315; scores[3] += -0.028069; break;
      case 4: scores[0] += 0.000966; scores[1] += 0.043728; scores[2] += -0.043078; scores[3] += -0.001617; break;
      case 5: scores[0] += -0.000978; scores[1] += 0.009486; scores[2] += -0.002068; scores[3] += -0.006439; break;
      case 6: scores[0] += -0.000181; scores[1] += 0.028502; scores[2] += -0.000824; scores[3] += -0.027497; break;
      case 7: scores[0] += -0.000009; scores[1] += 0.004112; scores[2] += -0.000011; scores[3] += -0.004092; break;
    }
  }

  // Tree 131 (depth=3)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[29] > 0.5) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012891; scores[1] += 0.014263; scores[2] += -0.027629; scores[3] += 0.000474; break;
      case 1: scores[0] += -0.039478; scores[1] += 0.013369; scores[2] += 0.007242; scores[3] += 0.018867; break;
      case 2: scores[0] += -0.000091; scores[1] += 0.057311; scores[2] += -0.000041; scores[3] += -0.057178; break;
      case 3: scores[0] += -0.001444; scores[1] += 0.008754; scores[2] += -0.001856; scores[3] += -0.005454; break;
      case 4: scores[0] += 0.049742; scores[1] += -0.010750; scores[2] += -0.008519; scores[3] += -0.030474; break;
      case 5: scores[0] += -0.043414; scores[1] += -0.012670; scores[2] += 0.028538; scores[3] += 0.027546; break;
      case 6: scores[0] += -0.000465; scores[1] += -0.003338; scores[2] += -0.000148; scores[3] += 0.003951; break;
      case 7: scores[0] += -0.001809; scores[1] += -0.016647; scores[2] += -0.001556; scores[3] += 0.020012; break;
    }
  }

  // Tree 132 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.022991543635725975) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007388; scores[1] += -0.007578; scores[2] += -0.000260; scores[3] += 0.000449; break;
      case 1: scores[0] += -0.000276; scores[1] += -0.000794; scores[2] += 0.033019; scores[3] += -0.031950; break;
      case 2: scores[0] += -0.025048; scores[1] += 0.034221; scores[2] += -0.038753; scores[3] += 0.029581; break;
      case 3: scores[0] += -0.000116; scores[1] += -0.000883; scores[2] += -0.001656; scores[3] += 0.002655; break;
      case 4: scores[0] += -0.001010; scores[1] += -0.000905; scores[2] += 0.046815; scores[3] += -0.044900; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000535; scores[1] += -0.018223; scores[2] += -0.001460; scores[3] += 0.020218; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 133 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.027822; scores[1] += -0.023268; scores[2] += -0.007331; scores[3] += 0.002777; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.047158; scores[1] += -0.003307; scores[2] += -0.005026; scores[3] += -0.038825; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.043813; scores[1] += 0.026011; scores[2] += -0.000251; scores[3] += 0.018052; break;
      case 5: scores[0] += -0.000116; scores[1] += -0.000880; scores[2] += -0.001649; scores[3] += 0.002645; break;
      case 6: scores[0] += -0.042052; scores[1] += -0.015814; scores[2] += 0.027464; scores[3] += 0.030402; break;
      case 7: scores[0] += -0.000274; scores[1] += -0.000788; scores[2] += 0.032075; scores[3] += -0.031013; break;
    }
  }

  // Tree 134 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[25] > 0.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.023874; scores[1] += -0.063432; scores[2] += 0.023073; scores[3] += 0.016484; break;
      case 1: scores[0] += -0.003266; scores[1] += -0.012066; scores[2] += -0.004107; scores[3] += 0.019440; break;
      case 2: scores[0] += -0.023563; scores[1] += 0.036419; scores[2] += -0.037932; scores[3] += 0.025075; break;
      case 3: scores[0] += -0.000566; scores[1] += 0.042739; scores[2] += -0.000520; scores[3] += -0.041654; break;
      case 4: scores[0] += -0.021662; scores[1] += 0.080599; scores[2] += -0.019075; scores[3] += -0.039862; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.002547; scores[1] += -0.041155; scores[2] += -0.005740; scores[3] += 0.049442; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 135 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.15192309021949768) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000974; scores[1] += 0.019034; scores[2] += -0.016479; scores[3] += -0.003530; break;
      case 1: scores[0] += -0.000689; scores[1] += -0.003134; scores[2] += 0.041093; scores[3] += -0.037270; break;
      case 2: scores[0] += -0.010286; scores[1] += -0.018443; scores[2] += -0.004892; scores[3] += 0.033621; break;
      case 3: scores[0] += -0.000478; scores[1] += -0.008853; scores[2] += -0.000386; scores[3] += 0.009717; break;
      case 4: scores[0] += 0.012331; scores[1] += -0.030999; scores[2] += 0.008164; scores[3] += 0.010504; break;
      case 5: scores[0] += -0.000515; scores[1] += -0.000284; scores[2] += 0.022357; scores[3] += -0.021558; break;
      case 6: scores[0] += -0.016829; scores[1] += 0.022836; scores[2] += -0.013897; scores[3] += 0.007890; break;
      case 7: scores[0] += -0.000084; scores[1] += -0.003804; scores[2] += -0.000480; scores[3] += 0.004369; break;
    }
  }

  // Tree 136 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.013522; scores[1] += 0.012168; scores[2] += -0.006587; scores[3] += 0.007941; break;
      case 1: scores[0] += -0.000109; scores[1] += -0.000804; scores[2] += -0.001547; scores[3] += 0.002460; break;
      case 2: scores[0] += 0.016603; scores[1] += -0.029132; scores[2] += 0.002930; scores[3] += 0.009599; break;
      case 3: scores[0] += -0.000274; scores[1] += -0.000835; scores[2] += 0.030940; scores[3] += -0.029831; break;
      case 4: scores[0] += -0.000465; scores[1] += -0.017399; scores[2] += -0.001322; scores[3] += 0.019186; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000959; scores[1] += -0.000918; scores[2] += 0.045413; scores[3] += -0.043536; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 137 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.024099882692098618) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009708; scores[1] += -0.006921; scores[2] += -0.007204; scores[3] += 0.004417; break;
      case 1: scores[0] += -0.000272; scores[1] += -0.000828; scores[2] += 0.030083; scores[3] += -0.028983; break;
      case 2: scores[0] += -0.022611; scores[1] += 0.032508; scores[2] += -0.034450; scores[3] += 0.024553; break;
      case 3: scores[0] += -0.000109; scores[1] += -0.000802; scores[2] += -0.001541; scores[3] += 0.002452; break;
      case 4: scores[0] += -0.004055; scores[1] += -0.001642; scores[2] += 0.081908; scores[3] += -0.076211; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.002339; scores[1] += -0.029755; scores[2] += -0.009092; scores[3] += 0.041186; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 138 (depth=3)
  {
    const leafIdx = ((features[13] > 0.3973684310913086) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[30] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007092; scores[1] += 0.017849; scores[2] += -0.029674; scores[3] += 0.004733; break;
      case 1: scores[0] += -0.002438; scores[1] += -0.034493; scores[2] += -0.002883; scores[3] += 0.039814; break;
      case 2: scores[0] += -0.021548; scores[1] += -0.023770; scores[2] += 0.031174; scores[3] += 0.014144; break;
      case 3: scores[0] += -0.002304; scores[1] += -0.012306; scores[2] += -0.002098; scores[3] += 0.016708; break;
      case 4: scores[0] += -0.000597; scores[1] += 0.051955; scores[2] += -0.000307; scores[3] += -0.051051; break;
      case 5: scores[0] += -0.003566; scores[1] += 0.015602; scores[2] += -0.001528; scores[3] += -0.010507; break;
      case 6: scores[0] += 0.035392; scores[1] += -0.024672; scores[2] += -0.042291; scores[3] += 0.031572; break;
      case 7: scores[0] += -0.004578; scores[1] += -0.029428; scores[2] += -0.001997; scores[3] += 0.036003; break;
    }
  }

  // Tree 139 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[13] > 0.5192592144012451) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001854; scores[1] += 0.008396; scores[2] += 0.010942; scores[3] += -0.017484; break;
      case 1: scores[0] += -0.005066; scores[1] += -0.035726; scores[2] += 0.025211; scores[3] += 0.015581; break;
      case 2: scores[0] += -0.010082; scores[1] += 0.022485; scores[2] += -0.041669; scores[3] += 0.029266; break;
      case 3: scores[0] += -0.002130; scores[1] += -0.008846; scores[2] += -0.037401; scores[3] += 0.048377; break;
      case 4: scores[0] += -0.006797; scores[1] += -0.026598; scores[2] += -0.003517; scores[3] += 0.036912; break;
      case 5: scores[0] += -0.000051; scores[1] += -0.003796; scores[2] += -0.000286; scores[3] += 0.004132; break;
      case 6: scores[0] += -0.000293; scores[1] += 0.029738; scores[2] += -0.000239; scores[3] += -0.029206; break;
      case 7: scores[0] += -0.000036; scores[1] += -0.002486; scores[2] += -0.000129; scores[3] += 0.002651; break;
    }
  }

  // Tree 140 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.15192309021949768) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002052; scores[1] += 0.015366; scores[2] += -0.014467; scores[3] += -0.002951; break;
      case 1: scores[0] += -0.000680; scores[1] += -0.003135; scores[2] += 0.039479; scores[3] += -0.035663; break;
      case 2: scores[0] += -0.009470; scores[1] += -0.016745; scores[2] += -0.004615; scores[3] += 0.030830; break;
      case 3: scores[0] += -0.000435; scores[1] += -0.008096; scores[2] += -0.000368; scores[3] += 0.008898; break;
      case 4: scores[0] += 0.010555; scores[1] += -0.027882; scores[2] += 0.007522; scores[3] += 0.009804; break;
      case 5: scores[0] += -0.000478; scores[1] += -0.000247; scores[2] += 0.020878; scores[3] += -0.020154; break;
      case 6: scores[0] += -0.015281; scores[1] += 0.020063; scores[2] += -0.012550; scores[3] += 0.007767; break;
      case 7: scores[0] += -0.000076; scores[1] += -0.003385; scores[2] += -0.000436; scores[3] += 0.003897; break;
    }
  }

  // Tree 141 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 9.875) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.026190; scores[1] += 0.007499; scores[2] += 0.014406; scores[3] += 0.004285; break;
      case 1: scores[0] += -0.016002; scores[1] += 0.000717; scores[2] += -0.027708; scores[3] += 0.042992; break;
      case 2: scores[0] += -0.018669; scores[1] += -0.000069; scores[2] += 0.010999; scores[3] += 0.007740; break;
      case 3: scores[0] += -0.001413; scores[1] += 0.014337; scores[2] += -0.016683; scores[3] += 0.003759; break;
      case 4: scores[0] += 0.043188; scores[1] += -0.010993; scores[2] += -0.017391; scores[3] += -0.014804; break;
      case 5: scores[0] += 0.022391; scores[1] += -0.027982; scores[2] += -0.027316; scores[3] += 0.032908; break;
      case 6: scores[0] += -0.002031; scores[1] += -0.007775; scores[2] += 0.066705; scores[3] += -0.056899; break;
      case 7: scores[0] += -0.001979; scores[1] += -0.002449; scores[2] += -0.021606; scores[3] += 0.026034; break;
    }
  }

  // Tree 142 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.011958; scores[1] += 0.009954; scores[2] += -0.004886; scores[3] += 0.006891; break;
      case 1: scores[0] += -0.000099; scores[1] += -0.000728; scores[2] += -0.001565; scores[3] += 0.002391; break;
      case 2: scores[0] += 0.015080; scores[1] += -0.026041; scores[2] += 0.002142; scores[3] += 0.008818; break;
      case 3: scores[0] += -0.000245; scores[1] += -0.000708; scores[2] += 0.028802; scores[3] += -0.027848; break;
      case 4: scores[0] += -0.000410; scores[1] += -0.015993; scores[2] += -0.001265; scores[3] += 0.017668; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000916; scores[1] += -0.000887; scores[2] += 0.042364; scores[3] += -0.040560; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 143 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[1] > 0.5) << 1) | ((features[11] > 0.023532669991254807) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003872; scores[1] += 0.018675; scores[2] += -0.025930; scores[3] += 0.011127; break;
      case 1: scores[0] += 0.015949; scores[1] += -0.001479; scores[2] += -0.000241; scores[3] += -0.014229; break;
      case 2: scores[0] += 0.005849; scores[1] += 0.027351; scores[2] += -0.004254; scores[3] += -0.028945; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.006296; scores[1] += -0.042649; scores[2] += 0.019817; scores[3] += 0.016536; break;
      case 5: scores[0] += 0.008307; scores[1] += -0.000118; scores[2] += -0.000424; scores[3] += -0.007765; break;
      case 6: scores[0] += -0.000165; scores[1] += 0.009162; scores[2] += -0.000406; scores[3] += -0.008591; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 144 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009835; scores[1] += 0.004543; scores[2] += -0.002052; scores[3] += 0.007344; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.009971; scores[1] += -0.021836; scores[2] += 0.017955; scores[3] += -0.006090; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.001939; scores[1] += 0.022618; scores[2] += -0.005409; scores[3] += -0.015270; break;
      case 5: scores[0] += -0.000098; scores[1] += -0.000685; scores[2] += -0.001565; scores[3] += 0.002347; break;
      case 6: scores[0] += -0.006849; scores[1] += -0.008342; scores[2] += -0.033741; scores[3] += 0.048932; break;
      case 7: scores[0] += -0.000241; scores[1] += -0.000661; scores[2] += 0.027959; scores[3] += -0.027057; break;
    }
  }

  // Tree 145 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.15192309021949768) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004147; scores[1] += 0.011871; scores[2] += -0.012474; scores[3] += -0.003543; break;
      case 1: scores[0] += -0.000644; scores[1] += -0.003010; scores[2] += 0.038948; scores[3] += -0.035294; break;
      case 2: scores[0] += -0.009073; scores[1] += -0.015701; scores[2] += -0.004432; scores[3] += 0.029205; break;
      case 3: scores[0] += -0.000401; scores[1] += -0.008033; scores[2] += -0.000358; scores[3] += 0.008792; break;
      case 4: scores[0] += 0.009054; scores[1] += -0.023464; scores[2] += 0.006101; scores[3] += 0.008310; break;
      case 5: scores[0] += -0.000456; scores[1] += -0.000211; scores[2] += 0.020006; scores[3] += -0.019338; break;
      case 6: scores[0] += -0.014617; scores[1] += 0.019202; scores[2] += -0.012027; scores[3] += 0.007442; break;
      case 7: scores[0] += -0.000074; scores[1] += -0.003453; scores[2] += -0.000448; scores[3] += 0.003975; break;
    }
  }

  // Tree 146 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[3] > 0.5) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000076; scores[1] += -0.009877; scores[2] += 0.007462; scores[3] += 0.002339; break;
      case 1: scores[0] += 0.005709; scores[1] += 0.026277; scores[2] += -0.004192; scores[3] += -0.027794; break;
      case 2: scores[0] += 0.001561; scores[1] += 0.036520; scores[2] += -0.040534; scores[3] += 0.002452; break;
      case 3: scores[0] += -0.000148; scores[1] += 0.008519; scores[2] += -0.000351; scores[3] += -0.008021; break;
      case 4: scores[0] += -0.007125; scores[1] += 0.026675; scores[2] += -0.002640; scores[3] += -0.016910; break;
      case 5: scores[0] += -0.000109; scores[1] += 0.001698; scores[2] += -0.000047; scores[3] += -0.001543; break;
      case 6: scores[0] += -0.000097; scores[1] += 0.039466; scores[2] += -0.000139; scores[3] += -0.039230; break;
      case 7: scores[0] += -0.000014; scores[1] += 0.000650; scores[2] += -0.000047; scores[3] += -0.000590; break;
    }
  }

  // Tree 147 (depth=3)
  {
    const leafIdx = ((features[43] > 0.22401434183120728) << 0) | ((features[29] > 0.5) << 1) | ((features[11] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007159; scores[1] += 0.018163; scores[2] += -0.028433; scores[3] += 0.003111; break;
      case 1: scores[0] += -0.002796; scores[1] += -0.013568; scores[2] += -0.001556; scores[3] += 0.017921; break;
      case 2: scores[0] += -0.000527; scores[1] += 0.063635; scores[2] += -0.000452; scores[3] += -0.062656; break;
      case 3: scores[0] += -0.000261; scores[1] += -0.035233; scores[2] += -0.000355; scores[3] += 0.035850; break;
      case 4: scores[0] += 0.008854; scores[1] += -0.041187; scores[2] += 0.017740; scores[3] += 0.014594; break;
      case 5: scores[0] += -0.002746; scores[1] += -0.003302; scores[2] += -0.001725; scores[3] += 0.007772; break;
      case 6: scores[0] += -0.001595; scores[1] += -0.018575; scores[2] += -0.001494; scores[3] += 0.021664; break;
      case 7: scores[0] += -0.000182; scores[1] += -0.001941; scores[2] += -0.000123; scores[3] += 0.002246; break;
    }
  }

  // Tree 148 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.17519181966781616) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001073; scores[1] += -0.006666; scores[2] += 0.010008; scores[3] += -0.002269; break;
      case 1: scores[0] += -0.006054; scores[1] += -0.033750; scores[2] += 0.008280; scores[3] += 0.031524; break;
      case 2: scores[0] += 0.007496; scores[1] += 0.001785; scores[2] += -0.015176; scores[3] += 0.005895; break;
      case 3: scores[0] += -0.000402; scores[1] += -0.000110; scores[2] += -0.022304; scores[3] += 0.022815; break;
      case 4: scores[0] += -0.007124; scores[1] += 0.026097; scores[2] += -0.002691; scores[3] += -0.016283; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000143; scores[1] += 0.037962; scores[2] += -0.000148; scores[3] += -0.037671; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 149 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[34] > 0.550000011920929) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004900; scores[1] += 0.002504; scores[2] += -0.000217; scores[3] += 0.002613; break;
      case 1: scores[0] += 0.008862; scores[1] += -0.001052; scores[2] += -0.000094; scores[3] += -0.007717; break;
      case 2: scores[0] += 0.002898; scores[1] += -0.000127; scores[2] += -0.000038; scores[3] += -0.002733; break;
      case 3: scores[0] += 0.014770; scores[1] += -0.000546; scores[2] += -0.000544; scores[3] += -0.013679; break;
      case 4: scores[0] += -0.000346; scores[1] += -0.001311; scores[2] += 0.025775; scores[3] += -0.024118; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 150 (depth=3)
  {
    const leafIdx = ((features[20] > 0.5) << 0) | ((features[13] > 0.0317540317773819) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.014561; scores[1] += -0.045874; scores[2] += 0.001006; scores[3] += 0.030307; break;
      case 1: scores[0] += -0.003068; scores[1] += 0.057777; scores[2] += 0.034734; scores[3] += -0.089442; break;
      case 2: scores[0] += -0.020812; scores[1] += 0.030704; scores[2] += -0.018777; scores[3] += 0.008885; break;
      case 3: scores[0] += -0.001663; scores[1] += -0.040579; scores[2] += -0.004399; scores[3] += 0.046641; break;
      case 4: scores[0] += 0.013051; scores[1] += -0.012655; scores[2] += 0.005091; scores[3] += -0.005487; break;
      case 5: scores[0] += -0.012978; scores[1] += -0.000958; scores[2] += -0.002319; scores[3] += 0.016255; break;
      case 6: scores[0] += -0.002851; scores[1] += -0.011306; scores[2] += -0.019651; scores[3] += 0.033808; break;
      case 7: scores[0] += -0.000543; scores[1] += -0.004091; scores[2] += -0.000712; scores[3] += 0.005346; break;
    }
  }

  // Tree 151 (depth=3)
  {
    const leafIdx = ((features[13] > 0.6120071411132812) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012429; scores[1] += -0.000546; scores[2] += -0.024342; scores[3] += 0.012459; break;
      case 1: scores[0] += -0.000767; scores[1] += -0.013348; scores[2] += -0.000291; scores[3] += 0.014405; break;
      case 2: scores[0] += -0.002430; scores[1] += 0.036596; scores[2] += -0.002163; scores[3] += -0.032003; break;
      case 3: scores[0] += -0.001680; scores[1] += -0.035627; scores[2] += -0.000835; scores[3] += 0.038142; break;
      case 4: scores[0] += 0.009674; scores[1] += -0.037651; scores[2] += 0.015653; scores[3] += 0.012323; break;
      case 5: scores[0] += -0.000756; scores[1] += -0.001511; scores[2] += -0.000213; scores[3] += 0.002480; break;
      case 6: scores[0] += -0.006826; scores[1] += -0.011038; scores[2] += -0.005017; scores[3] += 0.022882; break;
      case 7: scores[0] += -0.002959; scores[1] += -0.023281; scores[2] += -0.001161; scores[3] += 0.027401; break;
    }
  }

  // Tree 152 (depth=3)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[9] > 3.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.020279; scores[1] += -0.005704; scores[2] += -0.019028; scores[3] += 0.004453; break;
      case 1: scores[0] += -0.000810; scores[1] += 0.010128; scores[2] += -0.025343; scores[3] += 0.016025; break;
      case 2: scores[0] += -0.008749; scores[1] += 0.017435; scores[2] += 0.026881; scores[3] += -0.035568; break;
      case 3: scores[0] += -0.000015; scores[1] += 0.034837; scores[2] += -0.000108; scores[3] += -0.034714; break;
      case 4: scores[0] += -0.016810; scores[1] += 0.008550; scores[2] += 0.020063; scores[3] += -0.011803; break;
      case 5: scores[0] += -0.014674; scores[1] += 0.018256; scores[2] += -0.027296; scores[3] += 0.023714; break;
      case 6: scores[0] += -0.011221; scores[1] += -0.023455; scores[2] += 0.020083; scores[3] += 0.014593; break;
      case 7: scores[0] += -0.002587; scores[1] += -0.009827; scores[2] += -0.037021; scores[3] += 0.049435; break;
    }
  }

  // Tree 153 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007474; scores[1] += -0.027104; scores[2] += 0.022635; scores[3] += -0.003005; break;
      case 1: scores[0] += -0.002732; scores[1] += -0.024169; scores[2] += -0.003126; scores[3] += 0.030027; break;
      case 2: scores[0] += -0.011323; scores[1] += 0.071873; scores[2] += -0.055183; scores[3] += -0.005367; break;
      case 3: scores[0] += -0.000200; scores[1] += 0.022335; scores[2] += -0.000230; scores[3] += -0.021904; break;
      case 4: scores[0] += -0.019682; scores[1] += 0.028742; scores[2] += -0.034419; scores[3] += 0.025358; break;
      case 5: scores[0] += -0.000429; scores[1] += 0.037790; scores[2] += -0.000372; scores[3] += -0.036988; break;
      case 6: scores[0] += -0.001583; scores[1] += -0.014191; scores[2] += -0.009796; scores[3] += 0.025570; break;
      case 7: scores[0] += -0.000038; scores[1] += 0.011534; scores[2] += -0.000027; scores[3] += -0.011470; break;
    }
  }

  // Tree 154 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000094; scores[1] += -0.004874; scores[2] += 0.006691; scores[3] += -0.001723; break;
      case 1: scores[0] += -0.000999; scores[1] += 0.034889; scores[2] += -0.000496; scores[3] += -0.033394; break;
      case 2: scores[0] += 0.012962; scores[1] += -0.046968; scores[2] += 0.015141; scores[3] += 0.018866; break;
      case 3: scores[0] += -0.003375; scores[1] += -0.025655; scores[2] += -0.001098; scores[3] += 0.030128; break;
      case 4: scores[0] += -0.003586; scores[1] += 0.015600; scores[2] += -0.004284; scores[3] += -0.007729; break;
      case 5: scores[0] += -0.000267; scores[1] += 0.020030; scores[2] += -0.000242; scores[3] += -0.019521; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 155 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.021415; scores[1] += -0.057611; scores[2] += 0.019904; scores[3] += 0.016292; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.019665; scores[1] += 0.035600; scores[2] += -0.035902; scores[3] += 0.019967; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.018186; scores[1] += 0.076835; scores[2] += -0.024860; scores[3] += -0.033789; break;
      case 5: scores[0] += -0.000223; scores[1] += -0.000530; scores[2] += 0.027541; scores[3] += -0.026789; break;
      case 6: scores[0] += -0.001742; scores[1] += -0.040163; scores[2] += -0.004145; scores[3] += 0.046050; break;
      case 7: scores[0] += -0.000091; scores[1] += -0.000515; scores[2] += -0.001667; scores[3] += 0.002273; break;
    }
  }

  // Tree 156 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.024099882692098618) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008962; scores[1] += -0.005302; scores[2] += -0.008153; scores[3] += 0.004493; break;
      case 1: scores[0] += -0.000221; scores[1] += -0.000525; scores[2] += 0.026816; scores[3] += -0.026070; break;
      case 2: scores[0] += -0.018773; scores[1] += 0.028760; scores[2] += -0.032133; scores[3] += 0.022146; break;
      case 3: scores[0] += -0.000091; scores[1] += -0.000514; scores[2] += -0.001661; scores[3] += 0.002265; break;
      case 4: scores[0] += -0.003670; scores[1] += -0.003350; scores[2] += 0.078911; scores[3] += -0.071892; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001818; scores[1] += -0.027546; scores[2] += -0.008424; scores[3] += 0.037788; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 157 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.010247; scores[1] += 0.006972; scores[2] += -0.001167; scores[3] += 0.004443; break;
      case 1: scores[0] += -0.000090; scores[1] += -0.000512; scores[2] += -0.001655; scores[3] += 0.002258; break;
      case 2: scores[0] += 0.012237; scores[1] += -0.018744; scores[2] += -0.000665; scores[3] += 0.007172; break;
      case 3: scores[0] += -0.000219; scores[1] += -0.000521; scores[2] += 0.026121; scores[3] += -0.025381; break;
      case 4: scores[0] += -0.000329; scores[1] += -0.014821; scores[2] += -0.001039; scores[3] += 0.016189; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000887; scores[1] += -0.000711; scores[2] += 0.039462; scores[3] += -0.037864; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 158 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[13] > 0.6120071411132812) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001284; scores[1] += 0.024040; scores[2] += -0.025518; scores[3] += 0.002763; break;
      case 1: scores[0] += 0.015372; scores[1] += -0.001227; scores[2] += -0.000217; scores[3] += -0.013928; break;
      case 2: scores[0] += -0.001892; scores[1] += -0.035455; scores[2] += -0.000837; scores[3] += 0.038184; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.004032; scores[1] += -0.031088; scores[2] += 0.014871; scores[3] += 0.012185; break;
      case 5: scores[0] += 0.008111; scores[1] += -0.000082; scores[2] += -0.000410; scores[3] += -0.007619; break;
      case 6: scores[0] += -0.003004; scores[1] += -0.023554; scores[2] += -0.001069; scores[3] += 0.027628; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 159 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[35] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.013363; scores[1] += -0.016540; scores[2] += 0.022037; scores[3] += -0.018860; break;
      case 1: scores[0] += -0.016174; scores[1] += 0.008504; scores[2] += -0.033368; scores[3] += 0.041038; break;
      case 2: scores[0] += -0.021226; scores[1] += 0.023267; scores[2] += -0.024332; scores[3] += 0.022292; break;
      case 3: scores[0] += -0.000019; scores[1] += 0.039524; scores[2] += -0.000007; scores[3] += -0.039498; break;
      case 4: scores[0] += -0.000053; scores[1] += 0.017539; scores[2] += -0.048683; scores[3] += 0.031197; break;
      case 5: scores[0] += -0.001787; scores[1] += -0.017767; scores[2] += -0.019641; scores[3] += 0.039195; break;
      case 6: scores[0] += -0.015004; scores[1] += 0.058145; scores[2] += -0.018705; scores[3] += -0.024437; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 160 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001533; scores[1] += -0.011698; scores[2] += 0.017850; scores[3] += -0.004619; break;
      case 1: scores[0] += -0.002988; scores[1] += 0.009444; scores[2] += -0.002462; scores[3] += -0.003993; break;
      case 2: scores[0] += -0.009671; scores[1] += 0.021767; scores[2] += -0.036357; scores[3] += 0.024261; break;
      case 3: scores[0] += -0.000235; scores[1] += 0.026661; scores[2] += -0.000248; scores[3] += -0.026178; break;
      case 4: scores[0] += -0.000413; scores[1] += 0.048959; scores[2] += -0.041694; scores[3] += -0.006853; break;
      case 5: scores[0] += -0.000729; scores[1] += 0.008526; scores[2] += -0.001838; scores[3] += -0.005958; break;
      case 6: scores[0] += -0.000132; scores[1] += 0.027088; scores[2] += -0.000690; scores[3] += -0.026266; break;
      case 7: scores[0] += -0.000005; scores[1] += 0.004120; scores[2] += -0.000007; scores[3] += -0.004107; break;
    }
  }

  // Tree 161 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.2875939905643463) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001259; scores[1] += 0.017732; scores[2] += -0.017261; scores[3] += -0.001729; break;
      case 1: scores[0] += -0.000275; scores[1] += -0.000662; scores[2] += 0.024430; scores[3] += -0.023492; break;
      case 2: scores[0] += -0.011698; scores[1] += 0.000547; scores[2] += -0.006576; scores[3] += 0.017728; break;
      case 3: scores[0] += -0.000044; scores[1] += -0.000364; scores[2] += -0.000503; scores[3] += 0.000911; break;
      case 4: scores[0] += -0.006108; scores[1] += -0.010539; scores[2] += 0.065839; scores[3] += -0.049192; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000740; scores[1] += -0.026811; scores[2] += -0.001528; scores[3] += 0.029079; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 162 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[43] > 0.23669467866420746) << 1) | ((features[29] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005739; scores[1] += 0.006186; scores[2] += -0.000413; scores[3] += -0.000034; break;
      case 1: scores[0] += 0.019875; scores[1] += -0.001279; scores[2] += -0.000584; scores[3] += -0.018012; break;
      case 2: scores[0] += -0.003786; scores[1] += -0.014646; scores[2] += -0.002201; scores[3] += 0.020633; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.002578; scores[1] += 0.044216; scores[2] += -0.002288; scores[3] += -0.039350; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000254; scores[1] += -0.038082; scores[2] += -0.000258; scores[3] += 0.038595; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 163 (depth=3)
  {
    const leafIdx = ((features[43] > 0.23669467866420746) << 0) | ((features[29] > 0.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005719; scores[1] += 0.017366; scores[2] += -0.025081; scores[3] += 0.001996; break;
      case 1: scores[0] += -0.002085; scores[1] += -0.016442; scores[2] += -0.001081; scores[3] += 0.019608; break;
      case 2: scores[0] += -0.000433; scores[1] += 0.048000; scores[2] += -0.000389; scores[3] += -0.047178; break;
      case 3: scores[0] += -0.000180; scores[1] += -0.036768; scores[2] += -0.000215; scores[3] += 0.037163; break;
      case 4: scores[0] += 0.007594; scores[1] += -0.036777; scores[2] += 0.015399; scores[3] += 0.013784; break;
      case 5: scores[0] += -0.002103; scores[1] += 0.000540; scores[2] += -0.001323; scores[3] += 0.002886; break;
      case 6: scores[0] += -0.001312; scores[1] += -0.017240; scores[2] += -0.001161; scores[3] += 0.019713; break;
      case 7: scores[0] += -0.000110; scores[1] += -0.000899; scores[2] += -0.000061; scores[3] += 0.001069; break;
    }
  }

  // Tree 164 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.010009; scores[1] += 0.006732; scores[2] += -0.001112; scores[3] += 0.004389; break;
      case 1: scores[0] += -0.000089; scores[1] += -0.000471; scores[2] += -0.001677; scores[3] += 0.002237; break;
      case 2: scores[0] += 0.011972; scores[1] += -0.016634; scores[2] += -0.001610; scores[3] += 0.006272; break;
      case 3: scores[0] += -0.000213; scores[1] += -0.000474; scores[2] += 0.025015; scores[3] += -0.024327; break;
      case 4: scores[0] += -0.000327; scores[1] += -0.014687; scores[2] += -0.001097; scores[3] += 0.016111; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000876; scores[1] += -0.000633; scores[2] += 0.036656; scores[3] += -0.035147; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 165 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[35] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012590; scores[1] += -0.015238; scores[2] += 0.020260; scores[3] += -0.017612; break;
      case 1: scores[0] += -0.015761; scores[1] += 0.008760; scores[2] += -0.032600; scores[3] += 0.039601; break;
      case 2: scores[0] += -0.020969; scores[1] += 0.024575; scores[2] += -0.024071; scores[3] += 0.020465; break;
      case 3: scores[0] += -0.000018; scores[1] += 0.038298; scores[2] += -0.000006; scores[3] += -0.038274; break;
      case 4: scores[0] += 0.000651; scores[1] += 0.016417; scores[2] += -0.047466; scores[3] += 0.030398; break;
      case 5: scores[0] += -0.001522; scores[1] += -0.017966; scores[2] += -0.018655; scores[3] += 0.038143; break;
      case 6: scores[0] += -0.014825; scores[1] += 0.055208; scores[2] += -0.018428; scores[3] += -0.021955; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 166 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[2] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008523; scores[1] += -0.007450; scores[2] += 0.007151; scores[3] += -0.008224; break;
      case 1: scores[0] += 0.004286; scores[1] += 0.029924; scores[2] += -0.004211; scores[3] += -0.029999; break;
      case 2: scores[0] += 0.009680; scores[1] += -0.012101; scores[2] += -0.036500; scores[3] += 0.038921; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.018553; scores[1] += -0.003416; scores[2] += 0.021069; scores[3] += 0.000900; break;
      case 5: scores[0] += -0.000015; scores[1] += 0.000629; scores[2] += -0.000050; scores[3] += -0.000565; break;
      case 6: scores[0] += -0.003369; scores[1] += 0.013659; scores[2] += -0.031725; scores[3] += 0.021435; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 167 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.0317540317773819) << 1) | ((features[31] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012037; scores[1] += -0.002366; scores[2] += -0.016175; scores[3] += 0.006504; break;
      case 1: scores[0] += -0.000664; scores[1] += -0.002547; scores[2] += 0.035132; scores[3] += -0.031921; break;
      case 2: scores[0] += -0.018187; scores[1] += 0.019112; scores[2] += -0.009803; scores[3] += 0.008878; break;
      case 3: scores[0] += -0.000353; scores[1] += -0.007516; scores[2] += -0.000324; scores[3] += 0.008193; break;
      case 4: scores[0] += -0.011245; scores[1] += -0.003699; scores[2] += 0.016818; scores[3] += -0.001874; break;
      case 5: scores[0] += -0.000393; scores[1] += -0.000120; scores[2] += 0.016570; scores[3] += -0.016057; break;
      case 6: scores[0] += -0.004054; scores[1] += 0.005529; scores[2] += -0.027348; scores[3] += 0.025873; break;
      case 7: scores[0] += -0.000063; scores[1] += -0.003597; scores[2] += -0.000385; scores[3] += 0.004045; break;
    }
  }

  // Tree 168 (depth=3)
  {
    const leafIdx = ((features[5] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[22] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008350; scores[1] += -0.008850; scores[2] += 0.007633; scores[3] += -0.007132; break;
      case 1: scores[0] += 0.015070; scores[1] += -0.000500; scores[2] += -0.000526; scores[3] += -0.014044; break;
      case 2: scores[0] += -0.027764; scores[1] += 0.044459; scores[2] += -0.030353; scores[3] += 0.013658; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.013306; scores[1] += 0.005750; scores[2] += -0.034900; scores[3] += 0.042457; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000018; scores[1] += 0.037090; scores[2] += -0.000006; scores[3] += -0.037066; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 169 (depth=3)
  {
    const leafIdx = ((features[18] > 0.5) << 0) | ((features[13] > 0.11324786394834518) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012449; scores[1] += -0.023995; scores[2] += 0.004522; scores[3] += 0.007023; break;
      case 1: scores[0] += -0.000185; scores[1] += -0.000050; scores[2] += 0.015389; scores[3] += -0.015155; break;
      case 2: scores[0] += -0.017216; scores[1] += 0.017299; scores[2] += -0.013404; scores[3] += 0.013322; break;
      case 3: scores[0] += -0.000254; scores[1] += -0.013292; scores[2] += -0.001023; scores[3] += 0.014568; break;
      case 4: scores[0] += -0.017465; scores[1] += 0.074264; scores[2] += -0.025633; scores[3] += -0.031166; break;
      case 5: scores[0] += -0.000717; scores[1] += -0.000554; scores[2] += 0.026715; scores[3] += -0.025443; break;
      case 6: scores[0] += -0.001454; scores[1] += -0.039855; scores[2] += -0.002500; scores[3] += 0.043809; break;
      case 7: scores[0] += -0.000094; scores[1] += -0.002135; scores[2] += -0.000123; scores[3] += 0.002351; break;
    }
  }

  // Tree 170 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[34] > 0.25) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008537; scores[1] += 0.002202; scores[2] += -0.017187; scores[3] += 0.006448; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.010688; scores[1] += 0.032325; scores[2] += 0.029687; scores[3] += -0.051324; break;
      case 3: scores[0] += -0.004716; scores[1] += -0.024116; scores[2] += -0.005143; scores[3] += 0.033974; break;
      case 4: scores[0] += -0.004264; scores[1] += 0.023217; scores[2] += -0.011988; scores[3] += -0.006964; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.004715; scores[1] += 0.005655; scores[2] += -0.042424; scores[3] += 0.041484; break;
      case 7: scores[0] += -0.001514; scores[1] += -0.019162; scores[2] += 0.018181; scores[3] += 0.002495; break;
    }
  }

  // Tree 171 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.134848490357399) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000648; scores[1] += 0.013124; scores[2] += -0.006953; scores[3] += -0.005523; break;
      case 1: scores[0] += -0.000684; scores[1] += -0.002715; scores[2] += 0.034781; scores[3] += -0.031382; break;
      case 2: scores[0] += -0.007709; scores[1] += -0.017237; scores[2] += -0.004154; scores[3] += 0.029100; break;
      case 3: scores[0] += -0.000344; scores[1] += -0.007315; scores[2] += -0.000308; scores[3] += 0.007967; break;
      case 4: scores[0] += 0.008238; scores[1] += -0.020014; scores[2] += 0.003468; scores[3] += 0.008308; break;
      case 5: scores[0] += -0.000384; scores[1] += -0.000123; scores[2] += 0.015290; scores[3] += -0.014783; break;
      case 6: scores[0] += -0.011515; scores[1] += 0.018584; scores[2] += -0.012043; scores[3] += 0.004974; break;
      case 7: scores[0] += -0.000064; scores[1] += -0.003861; scores[2] += -0.000408; scores[3] += 0.004334; break;
    }
  }

  // Tree 172 (depth=3)
  {
    const leafIdx = ((features[43] > 0.20416666567325592) << 0) | ((features[29] > 0.5) << 1) | ((features[11] > 0.04257246479392052) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.006608; scores[1] += -0.000439; scores[2] += 0.018558; scores[3] += -0.011511; break;
      case 1: scores[0] += -0.002368; scores[1] += -0.011113; scores[2] += -0.001301; scores[3] += 0.014782; break;
      case 2: scores[0] += -0.000345; scores[1] += 0.059423; scores[2] += -0.000286; scores[3] += -0.058793; break;
      case 3: scores[0] += -0.000205; scores[1] += -0.035378; scores[2] += -0.000247; scores[3] += 0.035829; break;
      case 4: scores[0] += 0.007800; scores[1] += -0.026010; scores[2] += 0.005647; scores[3] += 0.012563; break;
      case 5: scores[0] += -0.002493; scores[1] += 0.001262; scores[2] += -0.001419; scores[3] += 0.002651; break;
      case 6: scores[0] += -0.001086; scores[1] += -0.015651; scores[2] += -0.000910; scores[3] += 0.017648; break;
      case 7: scores[0] += -0.000146; scores[1] += -0.001758; scores[2] += -0.000076; scores[3] += 0.001979; break;
    }
  }

  // Tree 173 (depth=3)
  {
    const leafIdx = ((features[43] > 0.22401434183120728) << 0) | ((features[9] > 4.5) << 1) | ((features[10] > 4.816666603088379) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003038; scores[1] += -0.004693; scores[2] += 0.013880; scores[3] += -0.012224; break;
      case 1: scores[0] += -0.000404; scores[1] += -0.017322; scores[2] += -0.000416; scores[3] += 0.018142; break;
      case 2: scores[0] += -0.000172; scores[1] += 0.024343; scores[2] += -0.000674; scores[3] += -0.023498; break;
      case 3: scores[0] += -0.000016; scores[1] += 0.004706; scores[2] += -0.000067; scores[3] += -0.004623; break;
      case 4: scores[0] += -0.004129; scores[1] += 0.003387; scores[2] += 0.007450; scores[3] += -0.006708; break;
      case 5: scores[0] += -0.003522; scores[1] += -0.015751; scores[2] += -0.001955; scores[3] += 0.021228; break;
      case 6: scores[0] += -0.009533; scores[1] += 0.023400; scores[2] += -0.035677; scores[3] += 0.021809; break;
      case 7: scores[0] += -0.000005; scores[1] += -0.002546; scores[2] += -0.000022; scores[3] += 0.002573; break;
    }
  }

  // Tree 174 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.23904761672019958) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006498; scores[1] += -0.008437; scores[2] += 0.000118; scores[3] += 0.001820; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.012666; scores[1] += 0.007105; scores[2] += -0.007426; scores[3] += 0.012986; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.017868; scores[1] += 0.055372; scores[2] += -0.015835; scores[3] += -0.021670; break;
      case 5: scores[0] += -0.000260; scores[1] += -0.000621; scores[2] += 0.022525; scores[3] += -0.021644; break;
      case 6: scores[0] += -0.000783; scores[1] += -0.036269; scores[2] += -0.001082; scores[3] += 0.038133; break;
      case 7: scores[0] += -0.000039; scores[1] += -0.000314; scores[2] += -0.000475; scores[3] += 0.000828; break;
    }
  }

  // Tree 175 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[10] > 13.833333969116211) << 1) | ((features[13] > 0.35388994216918945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.017600; scores[1] += 0.011519; scores[2] += 0.003046; scores[3] += 0.003035; break;
      case 1: scores[0] += -0.000603; scores[1] += 0.041312; scores[2] += -0.000346; scores[3] += -0.040363; break;
      case 2: scores[0] += 0.034566; scores[1] += -0.003357; scores[2] += -0.004880; scores[3] += -0.026330; break;
      case 3: scores[0] += -0.003080; scores[1] += -0.004201; scores[2] += -0.000905; scores[3] += 0.008185; break;
      case 4: scores[0] += -0.005714; scores[1] += -0.008931; scores[2] += -0.005648; scores[3] += 0.020293; break;
      case 5: scores[0] += -0.000236; scores[1] += 0.026880; scores[2] += -0.000144; scores[3] += -0.026501; break;
      case 6: scores[0] += -0.002301; scores[1] += -0.018188; scores[2] += -0.000540; scores[3] += 0.021029; break;
      case 7: scores[0] += -0.000774; scores[1] += -0.013180; scores[2] += -0.000344; scores[3] += 0.014299; break;
    }
  }

  // Tree 176 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[34] > 0.550000011920929) << 1) | ((features[13] > 0.025978408753871918) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001288; scores[1] += -0.011768; scores[2] += 0.006680; scores[3] += 0.003800; break;
      case 1: scores[0] += 0.018406; scores[1] += -0.001224; scores[2] += -0.000541; scores[3] += -0.016641; break;
      case 2: scores[0] += -0.000198; scores[1] += -0.000462; scores[2] += 0.023296; scores[3] += -0.022636; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.017386; scores[1] += 0.030079; scores[2] += -0.035607; scores[3] += 0.022915; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000084; scores[1] += -0.000432; scores[2] += -0.001735; scores[3] += 0.002251; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 177 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[0] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004623; scores[1] += 0.003148; scores[2] += 0.005716; scores[3] += -0.004241; break;
      case 1: scores[0] += -0.000038; scores[1] += -0.000304; scores[2] += -0.000460; scores[3] += 0.000802; break;
      case 2: scores[0] += 0.014523; scores[1] += -0.047813; scores[2] += 0.010784; scores[3] += 0.022506; break;
      case 3: scores[0] += -0.000252; scores[1] += -0.000619; scores[2] += 0.021385; scores[3] += -0.020514; break;
      case 4: scores[0] += -0.000145; scores[1] += -0.013861; scores[2] += -0.000211; scores[3] += 0.014217; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001109; scores[1] += -0.001183; scores[2] += 0.033643; scores[3] += -0.031351; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 178 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[43] > 0.17028985917568207) << 1) | ((features[29] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004488; scores[1] += 0.003068; scores[2] += 0.000761; scores[3] += 0.000659; break;
      case 1: scores[0] += 0.018078; scores[1] += -0.001224; scores[2] += -0.000537; scores[3] += -0.016317; break;
      case 2: scores[0] += -0.004742; scores[1] += -0.004871; scores[2] += -0.002812; scores[3] += 0.012425; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.001773; scores[1] += 0.050070; scores[2] += -0.001514; scores[3] += -0.046784; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000414; scores[1] += -0.031929; scores[2] += -0.000389; scores[3] += 0.032732; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 179 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001162; scores[1] += -0.010862; scores[2] += 0.016389; scores[3] += -0.004365; break;
      case 1: scores[0] += -0.002974; scores[1] += 0.007897; scores[2] += -0.002337; scores[3] += -0.002587; break;
      case 2: scores[0] += -0.008725; scores[1] += 0.017922; scores[2] += -0.032887; scores[3] += 0.023690; break;
      case 3: scores[0] += -0.000228; scores[1] += 0.025527; scores[2] += -0.000229; scores[3] += -0.025070; break;
      case 4: scores[0] += -0.000826; scores[1] += 0.049346; scores[2] += -0.040011; scores[3] += -0.008509; break;
      case 5: scores[0] += -0.000743; scores[1] += 0.008662; scores[2] += -0.001852; scores[3] += -0.006068; break;
      case 6: scores[0] += -0.000119; scores[1] += 0.026466; scores[2] += -0.000591; scores[3] += -0.025756; break;
      case 7: scores[0] += -0.000005; scores[1] += 0.004212; scores[2] += -0.000006; scores[3] += -0.004201; break;
    }
  }

  // Tree 180 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.1835016906261444) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001337; scores[1] += -0.005581; scores[2] += 0.008647; scores[3] += -0.001729; break;
      case 1: scores[0] += -0.005195; scores[1] += -0.031307; scores[2] += 0.007876; scores[3] += 0.028626; break;
      case 2: scores[0] += 0.004402; scores[1] += 0.009006; scores[2] += -0.012381; scores[3] += -0.001027; break;
      case 3: scores[0] += -0.000397; scores[1] += -0.000066; scores[2] += -0.021104; scores[3] += 0.021567; break;
      case 4: scores[0] += -0.005106; scores[1] += 0.023369; scores[2] += -0.001864; scores[3] += -0.016399; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000096; scores[1] += 0.030780; scores[2] += -0.000067; scores[3] += -0.030617; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 181 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[13] > 0.024695120751857758) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007233; scores[1] += -0.027318; scores[2] += 0.020315; scores[3] += -0.000230; break;
      case 1: scores[0] += -0.002840; scores[1] += -0.023007; scores[2] += -0.003062; scores[3] += 0.028909; break;
      case 2: scores[0] += -0.010243; scores[1] += 0.065470; scores[2] += -0.048925; scores[3] += -0.006303; break;
      case 3: scores[0] += -0.000205; scores[1] += 0.021370; scores[2] += -0.000218; scores[3] += -0.020946; break;
      case 4: scores[0] += -0.016328; scores[1] += 0.028667; scores[2] += -0.033627; scores[3] += 0.021288; break;
      case 5: scores[0] += -0.000327; scores[1] += 0.034681; scores[2] += -0.000269; scores[3] += -0.034084; break;
      case 6: scores[0] += -0.001083; scores[1] += -0.015191; scores[2] += -0.006578; scores[3] += 0.022852; break;
      case 7: scores[0] += -0.000028; scores[1] += 0.010052; scores[2] += -0.000018; scores[3] += -0.010006; break;
    }
  }

  // Tree 182 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008245; scores[1] += -0.007776; scores[2] += -0.006059; scores[3] += 0.005590; break;
      case 1: scores[0] += -0.000196; scores[1] += -0.000496; scores[2] += 0.023708; scores[3] += -0.023016; break;
      case 2: scores[0] += -0.016025; scores[1] += 0.028711; scores[2] += -0.031539; scores[3] += 0.018852; break;
      case 3: scores[0] += -0.000077; scores[1] += -0.000393; scores[2] += -0.001610; scores[3] += 0.002080; break;
      case 4: scores[0] += -0.003446; scores[1] += -0.002837; scores[2] += 0.070184; scores[3] += -0.063902; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001571; scores[1] += -0.025753; scores[2] += -0.009015; scores[3] += 0.036339; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 183 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[9] > 5.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002205; scores[1] += -0.017013; scores[2] += 0.019128; scores[3] += -0.004320; break;
      case 1: scores[0] += -0.005017; scores[1] += -0.000736; scores[2] += -0.011003; scores[3] += 0.016757; break;
      case 2: scores[0] += -0.001703; scores[1] += 0.022374; scores[2] += -0.033438; scores[3] += 0.012768; break;
      case 3: scores[0] += -0.000194; scores[1] += -0.000492; scores[2] += 0.023134; scores[3] += -0.022449; break;
      case 4: scores[0] += -0.016409; scores[1] += 0.030651; scores[2] += -0.031003; scores[3] += 0.016762; break;
      case 5: scores[0] += -0.000546; scores[1] += -0.027024; scores[2] += -0.006587; scores[3] += 0.034158; break;
      case 6: scores[0] += -0.000133; scores[1] += -0.037315; scores[2] += -0.000192; scores[3] += 0.037640; break;
      case 7: scores[0] += -0.000546; scores[1] += -0.002535; scores[2] += -0.005861; scores[3] += 0.008942; break;
    }
  }

  // Tree 184 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005422; scores[1] += -0.013087; scores[2] += 0.000639; scores[3] += 0.007027; break;
      case 1: scores[0] += 0.001967; scores[1] += 0.021075; scores[2] += -0.034089; scores[3] += 0.011048; break;
      case 2: scores[0] += -0.009366; scores[1] += 0.015583; scores[2] += -0.005332; scores[3] += -0.000884; break;
      case 3: scores[0] += -0.000219; scores[1] += 0.054687; scores[2] += -0.000373; scores[3] += -0.054096; break;
      case 4: scores[0] += -0.001474; scores[1] += -0.002612; scores[2] += 0.044353; scores[3] += -0.040267; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000815; scores[1] += -0.025128; scores[2] += -0.000468; scores[3] += 0.026411; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 185 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.013217; scores[1] += -0.011313; scores[2] += 0.005427; scores[3] += -0.007331; break;
      case 1: scores[0] += 0.009944; scores[1] += -0.008239; scores[2] += -0.036416; scores[3] += 0.034711; break;
      case 2: scores[0] += -0.014618; scores[1] += -0.011952; scores[2] += 0.028063; scores[3] += -0.001493; break;
      case 3: scores[0] += -0.002463; scores[1] += -0.000235; scores[2] += -0.027245; scores[3] += 0.029944; break;
      case 4: scores[0] += -0.012670; scores[1] += 0.012897; scores[2] += -0.007481; scores[3] += 0.007253; break;
      case 5: scores[0] += -0.004615; scores[1] += -0.014083; scores[2] += -0.001418; scores[3] += 0.020116; break;
      case 6: scores[0] += -0.002208; scores[1] += 0.015011; scores[2] += -0.028030; scores[3] += 0.015227; break;
      case 7: scores[0] += -0.000694; scores[1] += 0.011269; scores[2] += -0.011764; scores[3] += 0.001189; break;
    }
  }

  // Tree 186 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005452; scores[1] += -0.022010; scores[2] += 0.017410; scores[3] += -0.000852; break;
      case 1: scores[0] += -0.002925; scores[1] += -0.020938; scores[2] += -0.003071; scores[3] += 0.026935; break;
      case 2: scores[0] += -0.010007; scores[1] += 0.064678; scores[2] += -0.048191; scores[3] += -0.006479; break;
      case 3: scores[0] += -0.000216; scores[1] += 0.021431; scores[2] += -0.000228; scores[3] += -0.020988; break;
      case 4: scores[0] += -0.014831; scores[1] += 0.024343; scores[2] += -0.030178; scores[3] += 0.020666; break;
      case 5: scores[0] += -0.000285; scores[1] += 0.033002; scores[2] += -0.000223; scores[3] += -0.032494; break;
      case 6: scores[0] += -0.001157; scores[1] += -0.013423; scores[2] += -0.007195; scores[3] += 0.021775; break;
      case 7: scores[0] += -0.000025; scores[1] += 0.009597; scores[2] += -0.000016; scores[3] += -0.009556; break;
    }
  }

  // Tree 187 (depth=3)
  {
    const leafIdx = ((features[13] > 0.3380952477455139) << 0) | ((features[11] > 0.04257246479392052) << 1) | ((features[13] > 0.028991596773266792) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004125; scores[1] += -0.005891; scores[2] += 0.015277; scores[3] += -0.005261; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.009665; scores[1] += -0.024385; scores[2] += 0.006612; scores[3] += 0.008108; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.001392; scores[1] += 0.030404; scores[2] += -0.001437; scores[3] += -0.027575; break;
      case 5: scores[0] += -0.003807; scores[1] += -0.007496; scores[2] += -0.003598; scores[3] += 0.014900; break;
      case 6: scores[0] += -0.007846; scores[1] += 0.003597; scores[2] += -0.025028; scores[3] += 0.029278; break;
      case 7: scores[0] += -0.003691; scores[1] += -0.015514; scores[2] += -0.001949; scores[3] += 0.021154; break;
    }
  }

  // Tree 188 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.134848490357399) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001910; scores[1] += 0.017332; scores[2] += -0.012050; scores[3] += -0.003371; break;
      case 1: scores[0] += -0.000666; scores[1] += -0.002313; scores[2] += 0.031992; scores[3] += -0.029013; break;
      case 2: scores[0] += -0.005924; scores[1] += -0.018554; scores[2] += -0.003055; scores[3] += 0.027533; break;
      case 3: scores[0] += -0.000262; scores[1] += -0.006940; scores[2] += -0.000229; scores[3] += 0.007431; break;
      case 4: scores[0] += 0.007723; scores[1] += -0.017999; scores[2] += 0.003142; scores[3] += 0.007134; break;
      case 5: scores[0] += -0.000335; scores[1] += -0.000086; scores[2] += 0.013734; scores[3] += -0.013312; break;
      case 6: scores[0] += -0.008933; scores[1] += 0.014611; scores[2] += -0.009071; scores[3] += 0.003393; break;
      case 7: scores[0] += -0.000049; scores[1] += -0.003669; scores[2] += -0.000307; scores[3] += 0.004025; break;
    }
  }

  // Tree 189 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.023532669991254807) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.018169; scores[1] += -0.051727; scores[2] += 0.016767; scores[3] += 0.016790; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.014406; scores[1] += 0.029276; scores[2] += -0.030445; scores[3] += 0.015574; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.017209; scores[1] += 0.067225; scores[2] += -0.017294; scores[3] += -0.032722; break;
      case 5: scores[0] += -0.000192; scores[1] += -0.000487; scores[2] += 0.022870; scores[3] += -0.022191; break;
      case 6: scores[0] += -0.001173; scores[1] += -0.038621; scores[2] += -0.003175; scores[3] += 0.042970; break;
      case 7: scores[0] += -0.000071; scores[1] += -0.000360; scores[2] += -0.001400; scores[3] += 0.001830; break;
    }
  }

  // Tree 190 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005009; scores[1] += -0.020990; scores[2] += 0.016320; scores[3] += -0.000340; break;
      case 1: scores[0] += -0.002948; scores[1] += -0.019006; scores[2] += -0.003083; scores[3] += 0.025036; break;
      case 2: scores[0] += -0.009943; scores[1] += 0.060555; scores[2] += -0.045658; scores[3] += -0.004954; break;
      case 3: scores[0] += -0.000222; scores[1] += 0.021478; scores[2] += -0.000236; scores[3] += -0.021020; break;
      case 4: scores[0] += -0.013766; scores[1] += 0.022415; scores[2] += -0.027816; scores[3] += 0.019167; break;
      case 5: scores[0] += -0.000262; scores[1] += 0.031658; scores[2] += -0.000201; scores[3] += -0.031195; break;
      case 6: scores[0] += -0.001095; scores[1] += -0.012907; scores[2] += -0.006756; scores[3] += 0.020757; break;
      case 7: scores[0] += -0.000023; scores[1] += 0.009317; scores[2] += -0.000015; scores[3] += -0.009279; break;
    }
  }

  // Tree 191 (depth=3)
  {
    const leafIdx = ((features[16] > 0.5) << 0) | ((features[10] > 5.449999809265137) << 1) | ((features[39] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004638; scores[1] += 0.004033; scores[2] += -0.010362; scores[3] += 0.010968; break;
      case 1: scores[0] += -0.000173; scores[1] += -0.000264; scores[2] += 0.012734; scores[3] += -0.012297; break;
      case 2: scores[0] += -0.000527; scores[1] += 0.004880; scores[2] += -0.004830; scores[3] += 0.000477; break;
      case 3: scores[0] += -0.000524; scores[1] += -0.007490; scores[2] += 0.001151; scores[3] += 0.006864; break;
      case 4: scores[0] += -0.000349; scores[1] += -0.004114; scores[2] += 0.022406; scores[3] += -0.017943; break;
      case 5: scores[0] += -0.000124; scores[1] += -0.007332; scores[2] += 0.011806; scores[3] += -0.004350; break;
      case 6: scores[0] += -0.000715; scores[1] += -0.012962; scores[2] += 0.004928; scores[3] += 0.008750; break;
      case 7: scores[0] += -0.000101; scores[1] += -0.000865; scores[2] += 0.003017; scores[3] += -0.002052; break;
    }
  }

  // Tree 192 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.011113; scores[1] += 0.007487; scores[2] += -0.001166; scores[3] += 0.004792; break;
      case 1: scores[0] += -0.000069; scores[1] += -0.000347; scores[2] += -0.001349; scores[3] += 0.001765; break;
      case 2: scores[0] += 0.011548; scores[1] += -0.015614; scores[2] += -0.002194; scores[3] += 0.006260; break;
      case 3: scores[0] += -0.000195; scores[1] += -0.000533; scores[2] += 0.022954; scores[3] += -0.022225; break;
      case 4: scores[0] += -0.000229; scores[1] += -0.012377; scores[2] += -0.000718; scores[3] += 0.013323; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000880; scores[1] += -0.000549; scores[2] += 0.031885; scores[3] += -0.030456; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 193 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.15192309021949768) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001903; scores[1] += 0.017543; scores[2] += -0.011980; scores[3] += -0.003660; break;
      case 1: scores[0] += -0.000659; scores[1] += -0.002399; scores[2] += 0.031479; scores[3] += -0.028422; break;
      case 2: scores[0] += -0.005099; scores[1] += -0.018625; scores[2] += -0.002319; scores[3] += 0.026043; break;
      case 3: scores[0] += -0.000239; scores[1] += -0.006921; scores[2] += -0.000205; scores[3] += 0.007365; break;
      case 4: scores[0] += 0.006498; scores[1] += -0.016317; scores[2] += 0.003321; scores[3] += 0.006498; break;
      case 5: scores[0] += -0.000335; scores[1] += -0.000083; scores[2] += 0.013445; scores[3] += -0.013027; break;
      case 6: scores[0] += -0.008062; scores[1] += 0.011655; scores[2] += -0.006138; scores[3] += 0.002545; break;
      case 7: scores[0] += -0.000045; scores[1] += -0.003726; scores[2] += -0.000275; scores[3] += 0.004046; break;
    }
  }

  // Tree 194 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006225; scores[1] += -0.004768; scores[2] += -0.006610; scores[3] += 0.005153; break;
      case 1: scores[0] += -0.000194; scores[1] += -0.000518; scores[2] += 0.022441; scores[3] += -0.021729; break;
      case 2: scores[0] += -0.013216; scores[1] += 0.022673; scores[2] += -0.025343; scores[3] += 0.015886; break;
      case 3: scores[0] += -0.000068; scores[1] += -0.000346; scores[2] += -0.001339; scores[3] += 0.001754; break;
      case 4: scores[0] += -0.003391; scores[1] += -0.002159; scores[2] += 0.065271; scores[3] += -0.059720; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001260; scores[1] += -0.024497; scores[2] += -0.006957; scores[3] += 0.032714; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 195 (depth=3)
  {
    const leafIdx = ((features[43] > 0.18585526943206787) << 0) | ((features[29] > 0.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002668; scores[1] += 0.018435; scores[2] += -0.024905; scores[3] += 0.003803; break;
      case 1: scores[0] += -0.001429; scores[1] += -0.010444; scores[2] += -0.000771; scores[3] += 0.012644; break;
      case 2: scores[0] += -0.000217; scores[1] += 0.045235; scores[2] += -0.000156; scores[3] += -0.044862; break;
      case 3: scores[0] += -0.000138; scores[1] += -0.033148; scores[2] += -0.000162; scores[3] += 0.033448; break;
      case 4: scores[0] += 0.006471; scores[1] += -0.031800; scores[2] += 0.014084; scores[3] += 0.011246; break;
      case 5: scores[0] += -0.001822; scores[1] += -0.006975; scores[2] += -0.000916; scores[3] += 0.009712; break;
      case 6: scores[0] += -0.000694; scores[1] += -0.015450; scores[2] += -0.000548; scores[3] += 0.016691; break;
      case 7: scores[0] += -0.000162; scores[1] += -0.002358; scores[2] += -0.000081; scores[3] += 0.002602; break;
    }
  }

  // Tree 196 (depth=3)
  {
    const leafIdx = ((features[13] > 0.3693957030773163) << 0) | ((features[13] > 0.37268519401550293) << 1) | ((features[43] > 0.3603896200656891) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003621; scores[1] += 0.011740; scores[2] += -0.003637; scores[3] += -0.004482; break;
      case 1: scores[0] += -0.000048; scores[1] += -0.028339; scores[2] += -0.000025; scores[3] += 0.028412; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += -0.004880; scores[1] += -0.003038; scores[2] += -0.003864; scores[3] += 0.011782; break;
      case 4: scores[0] += -0.000037; scores[1] += 0.027103; scores[2] += -0.000015; scores[3] += -0.027051; break;
      case 5: scores[0] += -0.000009; scores[1] += -0.001158; scores[2] += -0.000009; scores[3] += 0.001175; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.001274; scores[1] += -0.022024; scores[2] += -0.000578; scores[3] += 0.023876; break;
    }
  }

  // Tree 197 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.010190; scores[1] += 0.006250; scores[2] += -0.000452; scores[3] += 0.004392; break;
      case 1: scores[0] += -0.000068; scores[1] += -0.000329; scores[2] += -0.001334; scores[3] += 0.001732; break;
      case 2: scores[0] += 0.010795; scores[1] += -0.014572; scores[2] += -0.001559; scores[3] += 0.005336; break;
      case 3: scores[0] += -0.000191; scores[1] += -0.000498; scores[2] += 0.021862; scores[3] += -0.021173; break;
      case 4: scores[0] += -0.000215; scores[1] += -0.011647; scores[2] += -0.000678; scores[3] += 0.012541; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000865; scores[1] += -0.000516; scores[2] += 0.029849; scores[3] += -0.028468; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 198 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[11] > 0.08759590983390808) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004358; scores[1] += 0.007093; scores[2] += -0.012145; scores[3] += 0.009411; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.022266; scores[1] += 0.013432; scores[2] += -0.027734; scores[3] += -0.007965; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.015852; scores[1] += -0.002599; scores[2] += 0.018934; scores[3] += -0.000483; break;
      case 5: scores[0] += -0.000030; scores[1] += -0.000231; scores[2] += -0.000338; scores[3] += 0.000598; break;
      case 6: scores[0] += -0.003721; scores[1] += 0.014016; scores[2] += -0.025445; scores[3] += 0.015150; break;
      case 7: scores[0] += -0.000235; scores[1] += -0.000615; scores[2] += 0.020318; scores[3] += -0.019467; break;
    }
  }

  // Tree 199 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005399; scores[1] += 0.001561; scores[2] += 0.001786; scores[3] += 0.002053; break;
      case 1: scores[0] += 0.007788; scores[1] += -0.000755; scores[2] += -0.000094; scores[3] += -0.006939; break;
      case 2: scores[0] += 0.002525; scores[1] += -0.000086; scores[2] += -0.000034; scores[3] += -0.002404; break;
      case 3: scores[0] += 0.011797; scores[1] += -0.000324; scores[2] += -0.000471; scores[3] += -0.011002; break;
      case 4: scores[0] += -0.000056; scores[1] += 0.010451; scores[2] += -0.000165; scores[3] += -0.010230; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 200 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[43] > 0.17028985917568207) << 1) | ((features[29] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000461; scores[1] += 0.002767; scores[2] += -0.000806; scores[3] += -0.001500; break;
      case 1: scores[0] += -0.003488; scores[1] += 0.009348; scores[2] += -0.003595; scores[3] += -0.002266; break;
      case 2: scores[0] += -0.003013; scores[1] += -0.010439; scores[2] += -0.001592; scores[3] += 0.015044; break;
      case 3: scores[0] += -0.000143; scores[1] += 0.018786; scores[2] += -0.000140; scores[3] += -0.018504; break;
      case 4: scores[0] += -0.001199; scores[1] += 0.038162; scores[2] += -0.000937; scores[3] += -0.036026; break;
      case 5: scores[0] += -0.000006; scores[1] += 0.005473; scores[2] += -0.000004; scores[3] += -0.005464; break;
      case 6: scores[0] += -0.000278; scores[1] += -0.032944; scores[2] += -0.000226; scores[3] += 0.033447; break;
      case 7: scores[0] += -0.000005; scores[1] += 0.002444; scores[2] += -0.000017; scores[3] += -0.002421; break;
    }
  }

  // Tree 201 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001421; scores[1] += -0.008872; scores[2] += 0.005723; scores[3] += 0.001728; break;
      case 1: scores[0] += -0.000913; scores[1] += 0.041460; scores[2] += -0.035340; scores[3] += -0.005207; break;
      case 2: scores[0] += -0.003367; scores[1] += 0.017545; scores[2] += -0.001043; scores[3] += -0.013135; break;
      case 3: scores[0] += -0.000025; scores[1] += 0.033584; scores[2] += -0.000018; scores[3] += -0.033542; break;
      case 4: scores[0] += -0.002929; scores[1] += 0.010578; scores[2] += -0.002273; scores[3] += -0.005375; break;
      case 5: scores[0] += -0.000624; scores[1] += 0.003561; scores[2] += -0.001441; scores[3] += -0.001497; break;
      case 6: scores[0] += -0.000114; scores[1] += 0.013012; scores[2] += -0.000056; scores[3] += -0.012842; break;
      case 7: scores[0] += -0.000037; scores[1] += 0.006818; scores[2] += -0.000068; scores[3] += -0.006712; break;
    }
  }

  // Tree 202 (depth=3)
  {
    const leafIdx = ((features[13] > 0.3207142949104309) << 0) | ((features[35] > 0.5) << 1) | ((features[9] > 2.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.033027; scores[1] += 0.013188; scores[2] += -0.024187; scores[3] += -0.022028; break;
      case 1: scores[0] += -0.004685; scores[1] += -0.001463; scores[2] += -0.001267; scores[3] += 0.007415; break;
      case 2: scores[0] += 0.019848; scores[1] += -0.015223; scores[2] += -0.004904; scores[3] += 0.000278; break;
      case 3: scores[0] += -0.000013; scores[1] += 0.041244; scores[2] += -0.000004; scores[3] += -0.041227; break;
      case 4: scores[0] += -0.051794; scores[1] += 0.026607; scores[2] += 0.024264; scores[3] += 0.000924; break;
      case 5: scores[0] += -0.002173; scores[1] += -0.016098; scores[2] += -0.003070; scores[3] += 0.021341; break;
      case 6: scores[0] += -0.021726; scores[1] += 0.029801; scores[2] += -0.045225; scores[3] += 0.037150; break;
      case 7: scores[0] += -0.000366; scores[1] += -0.004757; scores[2] += -0.000335; scores[3] += 0.005458; break;
    }
  }

  // Tree 203 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008053; scores[1] += 0.001053; scores[2] += -0.020552; scores[3] += 0.011446; break;
      case 1: scores[0] += -0.000087; scores[1] += 0.016235; scores[2] += -0.000139; scores[3] += -0.016009; break;
      case 2: scores[0] += 0.005592; scores[1] += -0.024087; scores[2] += 0.014373; scores[3] += 0.004123; break;
      case 3: scores[0] += -0.001732; scores[1] += -0.005691; scores[2] += -0.009874; scores[3] += 0.017298; break;
      case 4: scores[0] += -0.003985; scores[1] += 0.012773; scores[2] += -0.003381; scores[3] += -0.005407; break;
      case 5: scores[0] += -0.000022; scores[1] += -0.033196; scores[2] += -0.000017; scores[3] += 0.033234; break;
      case 6: scores[0] += -0.008430; scores[1] += -0.006500; scores[2] += -0.020658; scores[3] += 0.035588; break;
      case 7: scores[0] += -0.000362; scores[1] += -0.010194; scores[2] += -0.003547; scores[3] += 0.014103; break;
    }
  }

  // Tree 204 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.17519181966781616) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002082; scores[1] += -0.004619; scores[2] += 0.008371; scores[3] += -0.001670; break;
      case 1: scores[0] += -0.004525; scores[1] += -0.029928; scores[2] += 0.006847; scores[3] += 0.027605; break;
      case 2: scores[0] += 0.005728; scores[1] += 0.005288; scores[2] += -0.012779; scores[3] += 0.001763; break;
      case 3: scores[0] += -0.000370; scores[1] += -0.000051; scores[2] += -0.018774; scores[3] += 0.019195; break;
      case 4: scores[0] += -0.003469; scores[1] += 0.017758; scores[2] += -0.001060; scores[3] += -0.013229; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000076; scores[1] += 0.035199; scores[2] += -0.000060; scores[3] += -0.035064; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 205 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[24] > 0.5) << 1) | ((features[10] > 5.0833330154418945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008284; scores[1] += -0.006986; scores[2] += 0.016197; scores[3] += -0.000927; break;
      case 1: scores[0] += 0.004719; scores[1] += -0.000661; scores[2] += -0.000057; scores[3] += -0.004001; break;
      case 2: scores[0] += -0.000035; scores[1] += 0.006245; scores[2] += -0.000101; scores[3] += -0.006109; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.003213; scores[1] += 0.003063; scores[2] += -0.001421; scores[3] += 0.001571; break;
      case 5: scores[0] += 0.013385; scores[1] += -0.000392; scores[2] += -0.000475; scores[3] += -0.012519; break;
      case 6: scores[0] += -0.000020; scores[1] += 0.005027; scores[2] += -0.000062; scores[3] += -0.004945; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 206 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025978408753871918) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.018032; scores[1] += -0.050577; scores[2] += 0.016240; scores[3] += 0.016305; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.012550; scores[1] += 0.026587; scores[2] += -0.026881; scores[3] += 0.012843; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.016058; scores[1] += 0.063389; scores[2] += -0.016611; scores[3] += -0.030721; break;
      case 5: scores[0] += -0.000170; scores[1] += -0.000467; scores[2] += 0.021113; scores[3] += -0.020476; break;
      case 6: scores[0] += -0.000938; scores[1] += -0.037533; scores[2] += -0.002637; scores[3] += 0.041108; break;
      case 7: scores[0] += -0.000062; scores[1] += -0.000298; scores[2] += -0.001337; scores[3] += 0.001697; break;
    }
  }

  // Tree 207 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[22] > 0.5) << 1) | ((features[33] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.010809; scores[1] += -0.009982; scores[2] += 0.007183; scores[3] += -0.008010; break;
      case 1: scores[0] += 0.003263; scores[1] += 0.022542; scores[2] += -0.003933; scores[3] += -0.021871; break;
      case 2: scores[0] += -0.011216; scores[1] += 0.001061; scores[2] += -0.032332; scores[3] += 0.042487; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.025247; scores[1] += 0.038432; scores[2] += -0.027767; scores[3] += 0.014582; break;
      case 5: scores[0] += -0.000028; scores[1] += 0.012136; scores[2] += -0.000010; scores[3] += -0.012098; break;
      case 6: scores[0] += -0.000010; scores[1] += 0.033827; scores[2] += -0.000003; scores[3] += -0.033814; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 208 (depth=3)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[13] > 0.08514492958784103) << 1) | ((features[35] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.048179; scores[1] += -0.034575; scores[2] += -0.018200; scores[3] += 0.004595; break;
      case 1: scores[0] += -0.050004; scores[1] += 0.028436; scores[2] += 0.021680; scores[3] += -0.000112; break;
      case 2: scores[0] += -0.010044; scores[1] += 0.024080; scores[2] += -0.002120; scores[3] += -0.011916; break;
      case 3: scores[0] += -0.004169; scores[1] += -0.006933; scores[2] += -0.008938; scores[3] += 0.020040; break;
      case 4: scores[0] += 0.020388; scores[1] += -0.022617; scores[2] += -0.004505; scores[3] += 0.006734; break;
      case 5: scores[0] += -0.022100; scores[1] += 0.037224; scores[2] += -0.046987; scores[3] += 0.031863; break;
      case 6: scores[0] += -0.000016; scores[1] += 0.045510; scores[2] += -0.000005; scores[3] += -0.045489; break;
      case 7: scores[0] += -0.000883; scores[1] += -0.008681; scores[2] += -0.000825; scores[3] += 0.010388; break;
    }
  }

  // Tree 209 (depth=3)
  {
    const leafIdx = ((features[13] > 0.6120071411132812) << 0) | ((features[33] > 0.5) << 1) | ((features[11] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004283; scores[1] += 0.010059; scores[2] += -0.021674; scores[3] += 0.007331; break;
      case 1: scores[0] += -0.000932; scores[1] += -0.032409; scores[2] += -0.000375; scores[3] += 0.033717; break;
      case 2: scores[0] += -0.000081; scores[1] += 0.066773; scores[2] += -0.000034; scores[3] += -0.066658; break;
      case 3: scores[0] += -0.000104; scores[1] += -0.027866; scores[2] += -0.000059; scores[3] += 0.028029; break;
      case 4: scores[0] += 0.012374; scores[1] += -0.023353; scores[2] += 0.008323; scores[3] += 0.002656; break;
      case 5: scores[0] += -0.001587; scores[1] += -0.005166; scores[2] += -0.000339; scores[3] += 0.007092; break;
      case 6: scores[0] += -0.015575; scores[1] += -0.011566; scores[2] += -0.017512; scores[3] += 0.044653; break;
      case 7: scores[0] += -0.000335; scores[1] += -0.020093; scores[2] += -0.000218; scores[3] += 0.020646; break;
    }
  }

  // Tree 210 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[34] > 0.550000011920929) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.010330; scores[1] += 0.005252; scores[2] += 0.001345; scores[3] += 0.003733; break;
      case 1: scores[0] += -0.000046; scores[1] += 0.009800; scores[2] += -0.000133; scores[3] += -0.009621; break;
      case 2: scores[0] += -0.000061; scores[1] += -0.000287; scores[2] += -0.001373; scores[3] += 0.001721; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.010517; scores[1] += -0.015195; scores[2] += -0.000079; scores[3] += 0.004757; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000160; scores[1] += -0.000450; scores[2] += 0.020142; scores[3] += -0.019533; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 211 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[40] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003273; scores[1] += -0.022829; scores[2] += 0.023914; scores[3] += -0.004358; break;
      case 1: scores[0] += -0.000592; scores[1] += 0.034260; scores[2] += -0.033539; scores[3] += -0.000129; break;
      case 2: scores[0] += -0.002755; scores[1] += 0.009533; scores[2] += -0.000827; scores[3] += -0.005950; break;
      case 3: scores[0] += -0.000052; scores[1] += 0.035498; scores[2] += -0.000067; scores[3] += -0.035378; break;
      case 4: scores[0] += -0.006366; scores[1] += 0.021437; scores[2] += -0.023450; scores[3] += 0.008379; break;
      case 5: scores[0] += -0.001291; scores[1] += 0.014347; scores[2] += -0.002292; scores[3] += -0.010764; break;
      case 6: scores[0] += -0.000588; scores[1] += 0.020716; scores[2] += -0.000170; scores[3] += -0.019958; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 212 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[10] > 13.833333969116211) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.014331; scores[1] += 0.000114; scores[2] += 0.008166; scores[3] += 0.006052; break;
      case 1: scores[0] += -0.004365; scores[1] += 0.043237; scores[2] += -0.034864; scores[3] += -0.004009; break;
      case 2: scores[0] += -0.000437; scores[1] += 0.026875; scores[2] += -0.000192; scores[3] += -0.026245; break;
      case 3: scores[0] += -0.000052; scores[1] += 0.034893; scores[2] += -0.000066; scores[3] += -0.034775; break;
      case 4: scores[0] += 0.034714; scores[1] += -0.023706; scores[2] += -0.004147; scores[3] += -0.006861; break;
      case 5: scores[0] += 0.002628; scores[1] += -0.000009; scores[2] += -0.000072; scores[3] += -0.002546; break;
      case 6: scores[0] += -0.002281; scores[1] += -0.013968; scores[2] += -0.000628; scores[3] += 0.016877; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 213 (depth=3)
  {
    const leafIdx = ((features[43] > 0.1913919448852539) << 0) | ((features[10] > 6.550000190734863) << 1) | ((features[30] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.031946; scores[1] += 0.005078; scores[2] += 0.024978; scores[3] += 0.001890; break;
      case 1: scores[0] += -0.000175; scores[1] += -0.002520; scores[2] += -0.000435; scores[3] += 0.003131; break;
      case 2: scores[0] += 0.011190; scores[1] += -0.026386; scores[2] += 0.006938; scores[3] += 0.008258; break;
      case 3: scores[0] += -0.001148; scores[1] += 0.013619; scores[2] += -0.000596; scores[3] += -0.011874; break;
      case 4: scores[0] += -0.000516; scores[1] += 0.052130; scores[2] += -0.000846; scores[3] += -0.050769; break;
      case 5: scores[0] += -0.000221; scores[1] += -0.041261; scores[2] += -0.000112; scores[3] += 0.041595; break;
      case 6: scores[0] += 0.007999; scores[1] += 0.049230; scores[2] += -0.051925; scores[3] += -0.005305; break;
      case 7: scores[0] += -0.001047; scores[1] += -0.038827; scores[2] += -0.000359; scores[3] += 0.040233; break;
    }
  }

  // Tree 214 (depth=3)
  {
    const leafIdx = ((features[13] > 0.3693957030773163) << 0) | ((features[13] > 0.025978408753871918) << 1) | ((features[11] > 0.024695120751857758) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007267; scores[1] += 0.005067; scores[2] += -0.020496; scores[3] += 0.008162; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000976; scores[1] += 0.028182; scores[2] += -0.000820; scores[3] += -0.026386; break;
      case 3: scores[0] += -0.002319; scores[1] += -0.009122; scores[2] += -0.002053; scores[3] += 0.013494; break;
      case 4: scores[0] += 0.006321; scores[1] += -0.025534; scores[2] += 0.012210; scores[3] += 0.007003; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.006505; scores[1] += -0.002081; scores[2] += -0.021770; scores[3] += 0.030356; break;
      case 7: scores[0] += -0.002831; scores[1] += -0.017746; scores[2] += -0.001727; scores[3] += 0.022304; break;
    }
  }

  // Tree 215 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[13] > 0.11882352828979492) << 1) | ((features[13] > 0.03279569745063782) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004947; scores[1] += -0.010345; scores[2] += 0.013963; scores[3] += -0.008566; break;
      case 1: scores[0] += 0.008530; scores[1] += -0.006611; scores[2] += -0.037700; scores[3] += 0.035781; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.002062; scores[1] += 0.078806; scores[2] += -0.028171; scores[3] += -0.048573; break;
      case 5: scores[0] += -0.000142; scores[1] += -0.000551; scores[2] += -0.000973; scores[3] += 0.001667; break;
      case 6: scores[0] += -0.008416; scores[1] += 0.004178; scores[2] += -0.007966; scores[3] += 0.012203; break;
      case 7: scores[0] += -0.003663; scores[1] += -0.005973; scores[2] += -0.001565; scores[3] += 0.011201; break;
    }
  }

  // Tree 216 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[34] > 0.550000011920929) << 1) | ((features[11] > 0.040408164262771606) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009391; scores[1] += 0.002606; scores[2] += 0.009730; scores[3] += -0.002945; break;
      case 1: scores[0] += 0.012008; scores[1] += -0.000862; scores[2] += -0.000189; scores[3] += -0.010957; break;
      case 2: scores[0] += -0.000025; scores[1] += -0.000180; scores[2] += -0.000316; scores[3] += 0.000521; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.005506; scores[1] += -0.020856; scores[2] += 0.003466; scores[3] += 0.011884; break;
      case 5: scores[0] += 0.005544; scores[1] += -0.000033; scores[2] += -0.000320; scores[3] += -0.005191; break;
      case 6: scores[0] += -0.000183; scores[1] += -0.000512; scores[2] += 0.017835; scores[3] += -0.017139; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 217 (depth=3)
  {
    const leafIdx = ((features[13] > 0.6120071411132812) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007887; scores[1] += 0.000858; scores[2] += -0.020431; scores[3] += 0.011686; break;
      case 1: scores[0] += -0.000361; scores[1] += -0.011192; scores[2] += -0.000135; scores[3] += 0.011687; break;
      case 2: scores[0] += -0.000977; scores[1] += 0.025903; scores[2] += -0.000808; scores[3] += -0.024118; break;
      case 3: scores[0] += -0.000660; scores[1] += -0.032430; scores[2] += -0.000307; scores[3] += 0.033397; break;
      case 4: scores[0] += 0.006658; scores[1] += -0.026535; scores[2] += 0.010401; scores[3] += 0.009476; break;
      case 5: scores[0] += -0.000330; scores[1] += -0.000855; scores[2] += -0.000078; scores[3] += 0.001263; break;
      case 6: scores[0] += -0.003407; scores[1] += -0.005973; scores[2] += -0.001984; scores[3] += 0.011363; break;
      case 7: scores[0] += -0.001341; scores[1] += -0.019484; scores[2] += -0.000400; scores[3] += 0.021225; break;
    }
  }

  // Tree 218 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[13] > 0.15192309021949768) << 1) | ((features[31] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003614; scores[1] += 0.013366; scores[2] += -0.014675; scores[3] += -0.002306; break;
      case 1: scores[0] += -0.000410; scores[1] += -0.001691; scores[2] += 0.001845; scores[3] += 0.000256; break;
      case 2: scores[0] += -0.009205; scores[1] += 0.001750; scores[2] += -0.003688; scores[3] += 0.011144; break;
      case 3: scores[0] += -0.000003; scores[1] += -0.000094; scores[2] += -0.000012; scores[3] += 0.000109; break;
      case 4: scores[0] += -0.005604; scores[1] += 0.007347; scores[2] += 0.021051; scores[3] += -0.022794; break;
      case 5: scores[0] += -0.004634; scores[1] += -0.003398; scores[2] += -0.007534; scores[3] += 0.015567; break;
      case 6: scores[0] += -0.001540; scores[1] += 0.006250; scores[2] += -0.002430; scores[3] += -0.002280; break;
      case 7: scores[0] += -0.000141; scores[1] += -0.027172; scores[2] += -0.000973; scores[3] += 0.028287; break;
    }
  }

  // Tree 219 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.18019481003284454) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001472; scores[1] += -0.003397; scores[2] += 0.006359; scores[3] += -0.001491; break;
      case 1: scores[0] += -0.004131; scores[1] += -0.028849; scores[2] += 0.007130; scores[3] += 0.025850; break;
      case 2: scores[0] += 0.004858; scores[1] += 0.009900; scores[2] += -0.010785; scores[3] += -0.003972; break;
      case 3: scores[0] += -0.000346; scores[1] += -0.000044; scores[2] += -0.017114; scores[3] += 0.017504; break;
      case 4: scores[0] += -0.002985; scores[1] += 0.012641; scores[2] += -0.000925; scores[3] += -0.008731; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000062; scores[1] += 0.028203; scores[2] += -0.000036; scores[3] += -0.028105; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 220 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000140; scores[1] += -0.010374; scores[2] += 0.014465; scores[3] += -0.003950; break;
      case 1: scores[0] += -0.002528; scores[1] += 0.004835; scores[2] += -0.001992; scores[3] += -0.000315; break;
      case 2: scores[0] += -0.007388; scores[1] += 0.018351; scores[2] += -0.033314; scores[3] += 0.022351; break;
      case 3: scores[0] += -0.000202; scores[1] += 0.024108; scores[2] += -0.000223; scores[3] += -0.023683; break;
      case 4: scores[0] += -0.002546; scores[1] += 0.047491; scores[2] += -0.033736; scores[3] += -0.011209; break;
      case 5: scores[0] += -0.000598; scores[1] += 0.005961; scores[2] += -0.001608; scores[3] += -0.003755; break;
      case 6: scores[0] += -0.000089; scores[1] += 0.025166; scores[2] += -0.000410; scores[3] += -0.024668; break;
      case 7: scores[0] += -0.000003; scores[1] += 0.003934; scores[2] += -0.000004; scores[3] += -0.003927; break;
    }
  }

  // Tree 221 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009230; scores[1] += 0.005517; scores[2] += 0.000682; scores[3] += 0.003030; break;
      case 1: scores[0] += -0.000052; scores[1] += -0.000235; scores[2] += -0.001306; scores[3] += 0.001594; break;
      case 2: scores[0] += 0.010732; scores[1] += -0.011516; scores[2] += -0.004125; scores[3] += 0.004909; break;
      case 3: scores[0] += -0.000142; scores[1] += -0.000384; scores[2] += 0.019602; scores[3] += -0.019076; break;
      case 4: scores[0] += -0.000174; scores[1] += -0.010727; scores[2] += -0.000552; scores[3] += 0.011453; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000722; scores[1] += -0.000438; scores[2] += 0.027642; scores[3] += -0.026482; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 222 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[0] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002650; scores[1] += 0.000206; scores[2] += -0.006299; scores[3] += 0.003443; break;
      case 1: scores[0] += -0.000531; scores[1] += -0.001976; scores[2] += 0.028774; scores[3] += -0.026267; break;
      case 2: scores[0] += -0.005783; scores[1] += 0.010681; scores[2] += -0.004901; scores[3] += 0.000003; break;
      case 3: scores[0] += -0.000121; scores[1] += -0.008198; scores[2] += -0.000262; scores[3] += 0.008581; break;
      case 4: scores[0] += 0.008649; scores[1] += -0.023047; scores[2] += 0.006904; scores[3] += 0.007495; break;
      case 5: scores[0] += -0.000261; scores[1] += -0.000054; scores[2] += 0.011411; scores[3] += -0.011096; break;
      case 6: scores[0] += -0.004891; scores[1] += -0.025492; scores[2] += -0.016512; scores[3] += 0.046895; break;
      case 7: scores[0] += -0.000102; scores[1] += -0.000277; scores[2] += -0.000137; scores[3] += 0.000517; break;
    }
  }

  // Tree 223 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005090; scores[1] += -0.002921; scores[2] += -0.005081; scores[3] += 0.002912; break;
      case 1: scores[0] += -0.000141; scores[1] += -0.000369; scores[2] += 0.019177; scores[3] += -0.018666; break;
      case 2: scores[0] += -0.011151; scores[1] += 0.021289; scores[2] += -0.026724; scores[3] += 0.016586; break;
      case 3: scores[0] += -0.000051; scores[1] += -0.000231; scores[2] += -0.001242; scores[3] += 0.001524; break;
      case 4: scores[0] += -0.001111; scores[1] += -0.002285; scores[2] += 0.040574; scores[3] += -0.037178; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000511; scores[1] += -0.022656; scores[2] += -0.000268; scores[3] += 0.023435; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 224 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000180; scores[1] += -0.010205; scores[2] += 0.014235; scores[3] += -0.003851; break;
      case 1: scores[0] += -0.002551; scores[1] += 0.045688; scores[2] += -0.032648; scores[3] += -0.010489; break;
      case 2: scores[0] += -0.007299; scores[1] += 0.017744; scores[2] += -0.031785; scores[3] += 0.021340; break;
      case 3: scores[0] += -0.000088; scores[1] += 0.024964; scores[2] += -0.000404; scores[3] += -0.024471; break;
      case 4: scores[0] += -0.002521; scores[1] += 0.004565; scores[2] += -0.001947; scores[3] += -0.000098; break;
      case 5: scores[0] += -0.000591; scores[1] += 0.005803; scores[2] += -0.001575; scores[3] += -0.003638; break;
      case 6: scores[0] += -0.000200; scores[1] += 0.023666; scores[2] += -0.000220; scores[3] += -0.023247; break;
      case 7: scores[0] += -0.000003; scores[1] += 0.003882; scores[2] += -0.000004; scores[3] += -0.003876; break;
    }
  }

  // Tree 225 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[10] > 5.0833330154418945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002393; scores[1] += -0.003749; scores[2] += 0.002566; scores[3] += 0.003577; break;
      case 1: scores[0] += -0.000030; scores[1] += -0.014359; scores[2] += -0.000056; scores[3] += 0.014445; break;
      case 2: scores[0] += -0.001007; scores[1] += 0.020673; scores[2] += 0.018089; scores[3] += -0.037755; break;
      case 3: scores[0] += -0.000243; scores[1] += -0.002195; scores[2] += -0.004143; scores[3] += 0.006581; break;
      case 4: scores[0] += 0.005217; scores[1] += 0.015030; scores[2] += -0.024728; scores[3] += 0.004480; break;
      case 5: scores[0] += -0.000057; scores[1] += -0.009298; scores[2] += -0.000077; scores[3] += 0.009432; break;
      case 6: scores[0] += 0.006702; scores[1] += -0.032323; scores[2] += 0.013950; scores[3] += 0.011670; break;
      case 7: scores[0] += -0.001499; scores[1] += -0.010564; scores[2] += -0.008739; scores[3] += 0.020802; break;
    }
  }

  // Tree 226 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001519; scores[1] += -0.006627; scores[2] += 0.003885; scores[3] += 0.001224; break;
      case 1: scores[0] += -0.001902; scores[1] += 0.039545; scores[2] += -0.031391; scores[3] += -0.006253; break;
      case 2: scores[0] += -0.002624; scores[1] += 0.008573; scores[2] += -0.000783; scores[3] += -0.005166; break;
      case 3: scores[0] += -0.000023; scores[1] += 0.031469; scores[2] += -0.000017; scores[3] += -0.031430; break;
      case 4: scores[0] += -0.002620; scores[1] += 0.009509; scores[2] += -0.002065; scores[3] += -0.004824; break;
      case 5: scores[0] += -0.000553; scores[1] += 0.003810; scores[2] += -0.001505; scores[3] += -0.001752; break;
      case 6: scores[0] += -0.000083; scores[1] += 0.010814; scores[2] += -0.000039; scores[3] += -0.010691; break;
      case 7: scores[0] += -0.000031; scores[1] += 0.005997; scores[2] += -0.000057; scores[3] += -0.005909; break;
    }
  }

  // Tree 227 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.017238; scores[1] += -0.047776; scores[2] += 0.014935; scores[3] += 0.015603; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.010828; scores[1] += 0.023855; scores[2] += -0.025070; scores[3] += 0.012043; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.015307; scores[1] += 0.062776; scores[2] += -0.016447; scores[3] += -0.031022; break;
      case 5: scores[0] += -0.000141; scores[1] += -0.000372; scores[2] += 0.019618; scores[3] += -0.019105; break;
      case 6: scores[0] += -0.000783; scores[1] += -0.036624; scores[2] += -0.002410; scores[3] += 0.039817; break;
      case 7: scores[0] += -0.000048; scores[1] += -0.000222; scores[2] += -0.001147; scores[3] += 0.001417; break;
    }
  }

  // Tree 228 (depth=3)
  {
    const leafIdx = ((features[13] > 0.3207142949104309) << 0) | ((features[34] > 0.05000000074505806) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002760; scores[1] += -0.000920; scores[2] += -0.006191; scores[3] += 0.004351; break;
      case 1: scores[0] += -0.001514; scores[1] += -0.035874; scores[2] += -0.000520; scores[3] += 0.037908; break;
      case 2: scores[0] += 0.001930; scores[1] += 0.011253; scores[2] += -0.006519; scores[3] += -0.006664; break;
      case 3: scores[0] += -0.003838; scores[1] += 0.013519; scores[2] += -0.002807; scores[3] += -0.006874; break;
      case 4: scores[0] += -0.003252; scores[1] += 0.045422; scores[2] += 0.024059; scores[3] += -0.066229; break;
      case 5: scores[0] += -0.000210; scores[1] += -0.018629; scores[2] += -0.000164; scores[3] += 0.019003; break;
      case 6: scores[0] += -0.007924; scores[1] += -0.033328; scores[2] += 0.010292; scores[3] += 0.030960; break;
      case 7: scores[0] += -0.000172; scores[1] += -0.017702; scores[2] += -0.000588; scores[3] += 0.018461; break;
    }
  }

  // Tree 229 (depth=3)
  {
    const leafIdx = ((features[43] > 0.2124060094356537) << 0) | ((features[29] > 0.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003238; scores[1] += 0.015744; scores[2] += -0.021169; scores[3] += 0.002187; break;
      case 1: scores[0] += -0.000983; scores[1] += -0.012968; scores[2] += -0.000526; scores[3] += 0.014477; break;
      case 2: scores[0] += -0.000169; scores[1] += 0.032025; scores[2] += -0.000135; scores[3] += -0.031720; break;
      case 3: scores[0] += -0.000090; scores[1] += -0.031334; scores[2] += -0.000115; scores[3] += 0.031539; break;
      case 4: scores[0] += 0.005119; scores[1] += -0.026318; scores[2] += 0.011242; scores[3] += 0.009958; break;
      case 5: scores[0] += -0.001220; scores[1] += -0.001487; scores[2] += -0.000627; scores[3] += 0.003334; break;
      case 6: scores[0] += -0.000536; scores[1] += -0.012721; scores[2] += -0.000406; scores[3] += 0.013663; break;
      case 7: scores[0] += -0.000063; scores[1] += -0.000996; scores[2] += -0.000028; scores[3] += 0.001086; break;
    }
  }

  // Tree 230 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[10] > 4.9166669845581055) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003916; scores[1] += -0.012206; scores[2] += 0.004400; scores[3] += 0.003889; break;
      case 1: scores[0] += -0.000006; scores[1] += -0.022922; scores[2] += -0.000005; scores[3] += 0.022933; break;
      case 2: scores[0] += 0.002494; scores[1] += -0.001589; scores[2] += -0.001852; scores[3] += 0.000947; break;
      case 3: scores[0] += -0.000350; scores[1] += -0.010139; scores[2] += -0.002947; scores[3] += 0.013435; break;
      case 4: scores[0] += -0.000470; scores[1] += 0.014716; scores[2] += 0.008967; scores[3] += -0.023213; break;
      case 5: scores[0] += -0.000043; scores[1] += 0.000738; scores[2] += -0.000138; scores[3] += -0.000558; break;
      case 6: scores[0] += -0.013433; scores[1] += 0.018053; scores[2] += 0.010610; scores[3] += -0.015230; break;
      case 7: scores[0] += -0.001443; scores[1] += -0.003081; scores[2] += -0.010314; scores[3] += 0.014838; break;
    }
  }

  // Tree 231 (depth=3)
  {
    const leafIdx = ((features[43] > 0.20416666567325592) << 0) | ((features[29] > 0.5) << 1) | ((features[11] > 0.04257246479392052) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005241; scores[1] += 0.001668; scores[2] += 0.013106; scores[3] += -0.009533; break;
      case 1: scores[0] += -0.001070; scores[1] += -0.012441; scores[2] += -0.000577; scores[3] += 0.014088; break;
      case 2: scores[0] += -0.000164; scores[1] += 0.034108; scores[2] += -0.000133; scores[3] += -0.033812; break;
      case 3: scores[0] += -0.000093; scores[1] += -0.032140; scores[2] += -0.000116; scores[3] += 0.032348; break;
      case 4: scores[0] += 0.005698; scores[1] += -0.017847; scores[2] += 0.003293; scores[3] += 0.008857; break;
      case 5: scores[0] += -0.001246; scores[1] += 0.002957; scores[2] += -0.000617; scores[3] += -0.001094; break;
      case 6: scores[0] += -0.000531; scores[1] += -0.012496; scores[2] += -0.000405; scores[3] += 0.013432; break;
      case 7: scores[0] += -0.000063; scores[1] += -0.000993; scores[2] += -0.000028; scores[3] += 0.001083; break;
    }
  }

  // Tree 232 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[29] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.035058; scores[1] += 0.001701; scores[2] += -0.024031; scores[3] += -0.012729; break;
      case 1: scores[0] += 0.005170; scores[1] += -0.000709; scores[2] += -0.000373; scores[3] += -0.004088; break;
      case 2: scores[0] += -0.047818; scores[1] += 0.010616; scores[2] += 0.018779; scores[3] += 0.018422; break;
      case 3: scores[0] += -0.002196; scores[1] += 0.028482; scores[2] += -0.002935; scores[3] += -0.023350; break;
      case 4: scores[0] += -0.000165; scores[1] += 0.035563; scores[2] += -0.000037; scores[3] += -0.035361; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000741; scores[1] += -0.006575; scores[2] += -0.000668; scores[3] += 0.007984; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 233 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.550000190734863) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.028879; scores[1] += -0.004018; scores[2] += 0.027127; scores[3] += 0.005770; break;
      case 1: scores[0] += -0.000130; scores[1] += -0.000052; scores[2] += 0.014941; scores[3] += -0.014759; break;
      case 2: scores[0] += 0.014908; scores[1] += -0.002347; scores[2] += -0.012863; scores[3] += 0.000302; break;
      case 3: scores[0] += -0.000554; scores[1] += -0.009083; scores[2] += 0.018317; scores[3] += -0.008680; break;
      case 4: scores[0] += -0.004475; scores[1] += 0.024039; scores[2] += -0.002655; scores[3] += -0.016909; break;
      case 5: scores[0] += -0.000143; scores[1] += -0.002289; scores[2] += 0.006587; scores[3] += -0.004155; break;
      case 6: scores[0] += -0.008806; scores[1] += -0.002714; scores[2] += 0.002420; scores[3] += 0.009100; break;
      case 7: scores[0] += -0.000098; scores[1] += -0.000382; scores[2] += 0.001149; scores[3] += -0.000669; break;
    }
  }

  // Tree 234 (depth=3)
  {
    const leafIdx = ((features[18] > 0.5) << 0) | ((features[13] > 0.02817460335791111) << 1) | ((features[13] > 0.0889328122138977) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003305; scores[1] += -0.007469; scores[2] += 0.001954; scores[3] += 0.002211; break;
      case 1: scores[0] += -0.000647; scores[1] += -0.000391; scores[2] += 0.026808; scores[3] += -0.025771; break;
      case 2: scores[0] += -0.001634; scores[1] += 0.066759; scores[2] += -0.029566; scores[3] += -0.035559; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.010358; scores[1] += 0.006987; scores[2] += -0.009599; scores[3] += 0.012971; break;
      case 7: scores[0] += -0.000147; scores[1] += -0.010442; scores[2] += -0.000462; scores[3] += 0.011051; break;
    }
  }

  // Tree 235 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009299; scores[1] += 0.004643; scores[2] += 0.001953; scores[3] += 0.002704; break;
      case 1: scores[0] += -0.000044; scores[1] += -0.000213; scores[2] += -0.001113; scores[3] += 0.001370; break;
      case 2: scores[0] += 0.009131; scores[1] += -0.010006; scores[2] += -0.003131; scores[3] += 0.004006; break;
      case 3: scores[0] += -0.000128; scores[1] += -0.000335; scores[2] += 0.019551; scores[3] += -0.019087; break;
      case 4: scores[0] += -0.000146; scores[1] += -0.010271; scores[2] += -0.000457; scores[3] += 0.010874; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000642; scores[1] += -0.000388; scores[2] += 0.026126; scores[3] += -0.025096; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 236 (depth=3)
  {
    const leafIdx = ((features[43] > 0.17028985917568207) << 0) | ((features[29] > 0.5) << 1) | ((features[10] > 6.366666793823242) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.030121; scores[1] += 0.010519; scores[2] += 0.021332; scores[3] += -0.001730; break;
      case 1: scores[0] += -0.000272; scores[1] += -0.022066; scores[2] += -0.000366; scores[3] += 0.022704; break;
      case 2: scores[0] += -0.000024; scores[1] += 0.036243; scores[2] += -0.000048; scores[3] += -0.036171; break;
      case 3: scores[0] += -0.000060; scores[1] += -0.024325; scores[2] += -0.000108; scores[3] += 0.024493; break;
      case 4: scores[0] += 0.010110; scores[1] += -0.002652; scores[2] += -0.006893; scores[3] += -0.000566; break;
      case 5: scores[0] += -0.002442; scores[1] += 0.003066; scores[2] += -0.001064; scores[3] += 0.000440; break;
      case 6: scores[0] += -0.000719; scores[1] += 0.019386; scores[2] += -0.000518; scores[3] += -0.018149; break;
      case 7: scores[0] += -0.000155; scores[1] += -0.022953; scores[2] += -0.000090; scores[3] += 0.023198; break;
    }
  }

  // Tree 237 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[43] > 0.20416666567325592) << 1) | ((features[13] > 0.3623737394809723) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005875; scores[1] += 0.017226; scores[2] += -0.004701; scores[3] += -0.006650; break;
      case 1: scores[0] += 0.002390; scores[1] += 0.020432; scores[2] += -0.003442; scores[3] += -0.019380; break;
      case 2: scores[0] += -0.001136; scores[1] += -0.016177; scores[2] += -0.000673; scores[3] += 0.017985; break;
      case 3: scores[0] += -0.000033; scores[1] += 0.000949; scores[2] += -0.000024; scores[3] += -0.000892; break;
      case 4: scores[0] += -0.003623; scores[1] += -0.004804; scores[2] += -0.002877; scores[3] += 0.011305; break;
      case 5: scores[0] += -0.000022; scores[1] += 0.010675; scores[2] += -0.000007; scores[3] += -0.010646; break;
      case 6: scores[0] += -0.001019; scores[1] += -0.013685; scores[2] += -0.000501; scores[3] += 0.015205; break;
      case 7: scores[0] += -0.000004; scores[1] += 0.000123; scores[2] += -0.000001; scores[3] += -0.000118; break;
    }
  }

  // Tree 238 (depth=3)
  {
    const leafIdx = ((features[32] > 0.5) << 0) | ((features[10] > 5.550000190734863) << 1) | ((features[11] > 0.03637566417455673) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002684; scores[1] += -0.009126; scores[2] += 0.009070; scores[3] += 0.002740; break;
      case 1: scores[0] += -0.000114; scores[1] += 0.004809; scores[2] += -0.001113; scores[3] += -0.003582; break;
      case 2: scores[0] += -0.000464; scores[1] += 0.007312; scores[2] += -0.002840; scores[3] += -0.004008; break;
      case 3: scores[0] += -0.000831; scores[1] += -0.016635; scores[2] += -0.002982; scores[3] += 0.020447; break;
      case 4: scores[0] += -0.002754; scores[1] += 0.027054; scores[2] += -0.019287; scores[3] += -0.005013; break;
      case 5: scores[0] += -0.000454; scores[1] += -0.010485; scores[2] += 0.037201; scores[3] += -0.026262; break;
      case 6: scores[0] += 0.008446; scores[1] += -0.027004; scores[2] += 0.004392; scores[3] += 0.014167; break;
      case 7: scores[0] += -0.001849; scores[1] += -0.005928; scores[2] += 0.030559; scores[3] += -0.022781; break;
    }
  }

  // Tree 239 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[1] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005963; scores[1] += 0.000610; scores[2] += 0.003047; scores[3] += 0.002306; break;
      case 1: scores[0] += 0.007166; scores[1] += -0.000625; scores[2] += -0.000086; scores[3] += -0.006455; break;
      case 2: scores[0] += 0.002139; scores[1] += -0.000061; scores[2] += -0.000026; scores[3] += -0.002051; break;
      case 3: scores[0] += 0.009612; scores[1] += -0.000219; scores[2] += -0.000371; scores[3] += -0.009022; break;
      case 4: scores[0] += 0.002335; scores[1] += 0.025934; scores[2] += -0.003243; scores[3] += -0.025026; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 240 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.1835016906261444) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001512; scores[1] += -0.004795; scores[2] += 0.008021; scores[3] += -0.001715; break;
      case 1: scores[0] += -0.003847; scores[1] += -0.027613; scores[2] += 0.007590; scores[3] += 0.023870; break;
      case 2: scores[0] += 0.002674; scores[1] += 0.010616; scores[2] += -0.009691; scores[3] += -0.003600; break;
      case 3: scores[0] += -0.000333; scores[1] += -0.000040; scores[2] += -0.015829; scores[3] += 0.016202; break;
      case 4: scores[0] += -0.002752; scores[1] += 0.015083; scores[2] += -0.000797; scores[3] += -0.011534; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000058; scores[1] += 0.027555; scores[2] += -0.000031; scores[3] += -0.027467; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 241 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.15192309021949768) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000441; scores[1] += 0.011081; scores[2] += -0.008580; scores[3] += -0.002060; break;
      case 1: scores[0] += -0.000467; scores[1] += -0.001861; scores[2] += 0.027183; scores[3] += -0.024854; break;
      case 2: scores[0] += -0.003783; scores[1] += -0.018585; scores[2] += -0.001676; scores[3] += 0.024043; break;
      case 3: scores[0] += -0.000158; scores[1] += -0.005394; scores[2] += -0.000168; scores[3] += 0.005720; break;
      case 4: scores[0] += 0.004833; scores[1] += -0.012122; scores[2] += 0.002628; scores[3] += 0.004661; break;
      case 5: scores[0] += -0.000238; scores[1] += -0.000045; scores[2] += 0.010950; scores[3] += -0.010668; break;
      case 6: scores[0] += -0.005951; scores[1] += 0.012173; scores[2] += -0.004368; scores[3] += -0.001854; break;
      case 7: scores[0] += -0.000031; scores[1] += -0.003196; scores[2] += -0.000207; scores[3] += 0.003434; break;
    }
  }

  // Tree 242 (depth=3)
  {
    const leafIdx = ((features[13] > 0.7211111187934875) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008282; scores[1] += -0.003432; scores[2] += -0.018093; scores[3] += 0.013243; break;
      case 1: scores[0] += -0.000289; scores[1] += -0.009544; scores[2] += -0.000062; scores[3] += 0.009895; break;
      case 2: scores[0] += -0.000860; scores[1] += 0.025287; scores[2] += -0.000727; scores[3] += -0.023700; break;
      case 3: scores[0] += -0.000462; scores[1] += -0.037241; scores[2] += -0.000216; scores[3] += 0.037919; break;
      case 4: scores[0] += 0.004771; scores[1] += -0.024512; scores[2] += 0.011479; scores[3] += 0.008261; break;
      case 5: scores[0] += -0.000257; scores[1] += -0.000278; scores[2] += -0.000047; scores[3] += 0.000583; break;
      case 6: scores[0] += -0.003119; scores[1] += -0.002129; scores[2] += -0.001800; scores[3] += 0.007049; break;
      case 7: scores[0] += -0.001161; scores[1] += -0.018668; scores[2] += -0.000315; scores[3] += 0.020144; break;
    }
  }

  // Tree 243 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[10] > 10.875) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.016310; scores[1] += 0.003401; scores[2] += 0.009739; scores[3] += 0.003170; break;
      case 1: scores[0] += -0.000237; scores[1] += 0.023903; scores[2] += -0.000164; scores[3] += -0.023502; break;
      case 2: scores[0] += -0.020540; scores[1] += -0.026976; scores[2] += 0.018449; scores[3] += 0.029067; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.027141; scores[1] += -0.026944; scores[2] += -0.004751; scores[3] += 0.004554; break;
      case 5: scores[0] += -0.000255; scores[1] += 0.020462; scores[2] += -0.000081; scores[3] += -0.020126; break;
      case 6: scores[0] += 0.018625; scores[1] += -0.007093; scores[2] += 0.015680; scores[3] += -0.027212; break;
      case 7: scores[0] += -0.001591; scores[1] += -0.020912; scores[2] += -0.000393; scores[3] += 0.022896; break;
    }
  }

  // Tree 244 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[14] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004905; scores[1] += -0.027705; scores[2] += 0.020216; scores[3] += 0.002585; break;
      case 1: scores[0] += 0.002458; scores[1] += 0.004341; scores[2] += -0.025037; scores[3] += 0.018237; break;
      case 2: scores[0] += -0.007026; scores[1] += 0.032872; scores[2] += -0.036152; scores[3] += 0.010307; break;
      case 3: scores[0] += -0.000071; scores[1] += 0.017719; scores[2] += -0.000389; scores[3] += -0.017260; break;
      case 4: scores[0] += -0.005955; scores[1] += 0.011277; scores[2] += -0.003063; scores[3] += -0.002259; break;
      case 5: scores[0] += -0.000112; scores[1] += 0.044986; scores[2] += -0.000157; scores[3] += -0.044716; break;
      case 6: scores[0] += -0.000037; scores[1] += -0.013662; scores[2] += -0.000072; scores[3] += 0.013772; break;
      case 7: scores[0] += -0.000004; scores[1] += 0.010883; scores[2] += -0.000012; scores[3] += -0.010867; break;
    }
  }

  // Tree 245 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[31] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008748; scores[1] += -0.003978; scores[2] += -0.010657; scores[3] += 0.005887; break;
      case 1: scores[0] += -0.000452; scores[1] += -0.001705; scores[2] += 0.026462; scores[3] += -0.024305; break;
      case 2: scores[0] += -0.009632; scores[1] += 0.010685; scores[2] += -0.006012; scores[3] += 0.004959; break;
      case 3: scores[0] += -0.000151; scores[1] += -0.005112; scores[2] += -0.000169; scores[3] += 0.005433; break;
      case 4: scores[0] += -0.007661; scores[1] += -0.000822; scores[2] += 0.011181; scores[3] += -0.002698; break;
      case 5: scores[0] += -0.000222; scores[1] += -0.000039; scores[2] += 0.010685; scores[3] += -0.010424; break;
      case 6: scores[0] += -0.002197; scores[1] += 0.009697; scores[2] += -0.022487; scores[3] += 0.014987; break;
      case 7: scores[0] += -0.000030; scores[1] += -0.003031; scores[2] += -0.000205; scores[3] += 0.003266; break;
    }
  }

  // Tree 246 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[43] > 0.28285714983940125) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002016; scores[1] += -0.004173; scores[2] += 0.011516; scores[3] += -0.005326; break;
      case 1: scores[0] += -0.000821; scores[1] += 0.031779; scores[2] += -0.029144; scores[3] += -0.001814; break;
      case 2: scores[0] += -0.006588; scores[1] += 0.021511; scores[2] += -0.030557; scores[3] += 0.015634; break;
      case 3: scores[0] += -0.000075; scores[1] += 0.020861; scores[2] += -0.000392; scores[3] += -0.020395; break;
      case 4: scores[0] += -0.001156; scores[1] += -0.018596; scores[2] += -0.000522; scores[3] += 0.020275; break;
      case 5: scores[0] += -0.000043; scores[1] += 0.020830; scores[2] += -0.000065; scores[3] += -0.020722; break;
      case 6: scores[0] += -0.000005; scores[1] += 0.000493; scores[2] += -0.000021; scores[3] += -0.000467; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.007076; scores[2] += -0.000007; scores[3] += -0.007067; break;
    }
  }

  // Tree 247 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.3816526532173157) << 1) | ((features[35] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002428; scores[1] += 0.007797; scores[2] += 0.005614; scores[3] += -0.010982; break;
      case 1: scores[0] += -0.000140; scores[1] += -0.000402; scores[2] += 0.019337; scores[3] += -0.018795; break;
      case 2: scores[0] += -0.003736; scores[1] += -0.009932; scores[2] += -0.002505; scores[3] += 0.016172; break;
      case 3: scores[0] += -0.000016; scores[1] += -0.000133; scores[2] += -0.000224; scores[3] += 0.000372; break;
      case 4: scores[0] += -0.001354; scores[1] += 0.020185; scores[2] += -0.047105; scores[3] += 0.028274; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000205; scores[1] += 0.006159; scores[2] += -0.000198; scores[3] += -0.005757; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 248 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005769; scores[1] += 0.004553; scores[2] += -0.016542; scores[3] += 0.006219; break;
      case 1: scores[0] += -0.000046; scores[1] += -0.024414; scores[2] += -0.000062; scores[3] += 0.024522; break;
      case 2: scores[0] += 0.004075; scores[1] += -0.013458; scores[2] += 0.004866; scores[3] += 0.004517; break;
      case 3: scores[0] += -0.000254; scores[1] += -0.004622; scores[2] += -0.002728; scores[3] += 0.007604; break;
      case 4: scores[0] += -0.002061; scores[1] += 0.027347; scores[2] += -0.005569; scores[3] += -0.019717; break;
      case 5: scores[0] += -0.000015; scores[1] += 0.005227; scores[2] += -0.000038; scores[3] += -0.005173; break;
      case 6: scores[0] += -0.008639; scores[1] += -0.020824; scores[2] += 0.026244; scores[3] += 0.003219; break;
      case 7: scores[0] += -0.001202; scores[1] += -0.007801; scores[2] += -0.007172; scores[3] += 0.016176; break;
    }
  }

  // Tree 249 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[11] > 0.040408164262771606) << 1) | ((features[17] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008109; scores[1] += 0.000934; scores[2] += 0.009766; scores[3] += -0.002591; break;
      case 1: scores[0] += 0.011274; scores[1] += -0.000784; scores[2] += -0.000166; scores[3] += -0.010324; break;
      case 2: scores[0] += 0.003073; scores[1] += -0.012972; scores[2] += 0.000890; scores[3] += 0.009009; break;
      case 3: scores[0] += 0.004954; scores[1] += -0.000021; scores[2] += -0.000299; scores[3] += -0.004634; break;
      case 4: scores[0] += -0.000097; scores[1] += -0.007259; scores[2] += -0.000226; scores[3] += 0.007581; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000732; scores[1] += -0.001871; scores[2] += 0.030739; scores[3] += -0.028136; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 250 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.044275; scores[1] += -0.009041; scores[2] += -0.004138; scores[3] += -0.031097; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.006133; scores[1] += -0.007144; scores[2] += -0.001193; scores[3] += 0.014469; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.048700; scores[1] += 0.008362; scores[2] += 0.019927; scores[3] += 0.020411; break;
      case 5: scores[0] += -0.000114; scores[1] += -0.000315; scores[2] += 0.020033; scores[3] += -0.019604; break;
      case 6: scores[0] += -0.005120; scores[1] += 0.020031; scores[2] += -0.025509; scores[3] += 0.010598; break;
      case 7: scores[0] += -0.000036; scores[1] += -0.000191; scores[2] += -0.000977; scores[3] += 0.001204; break;
    }
  }

  // Tree 251 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.015366; scores[1] += -0.045264; scores[2] += 0.015032; scores[3] += 0.014866; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.009895; scores[1] += 0.023060; scores[2] += -0.023613; scores[3] += 0.010447; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.011871; scores[1] += 0.054743; scores[2] += -0.013496; scores[3] += -0.029377; break;
      case 5: scores[0] += -0.000113; scores[1] += -0.000312; scores[2] += 0.019592; scores[3] += -0.019167; break;
      case 6: scores[0] += -0.000622; scores[1] += -0.036109; scores[2] += -0.002374; scores[3] += 0.039104; break;
      case 7: scores[0] += -0.000036; scores[1] += -0.000191; scores[2] += -0.000975; scores[3] += 0.001201; break;
    }
  }

  // Tree 252 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.028991596773266792) << 1) | ((features[13] > 0.10668563842773438) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002895; scores[1] += -0.006505; scores[2] += 0.002264; scores[3] += 0.001346; break;
      case 1: scores[0] += -0.000112; scores[1] += -0.000309; scores[2] += 0.019166; scores[3] += -0.018744; break;
      case 2: scores[0] += -0.001954; scores[1] += 0.062554; scores[2] += -0.028016; scores[3] += -0.032584; break;
      case 3: scores[0] += -0.000021; scores[1] += -0.000062; scores[2] += -0.000760; scores[3] += 0.000843; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.009047; scores[1] += 0.004368; scores[2] += -0.007549; scores[3] += 0.012228; break;
      case 7: scores[0] += -0.000016; scores[1] += -0.000130; scores[2] += -0.000220; scores[3] += 0.000365; break;
    }
  }

  // Tree 253 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.010415; scores[1] += -0.009315; scores[2] += 0.004331; scores[3] += -0.005430; break;
      case 1: scores[0] += 0.006415; scores[1] += -0.004191; scores[2] += -0.033114; scores[3] += 0.030889; break;
      case 2: scores[0] += -0.010360; scores[1] += -0.009772; scores[2] += 0.023424; scores[3] += -0.003292; break;
      case 3: scores[0] += -0.001863; scores[1] += -0.000091; scores[2] += -0.026687; scores[3] += 0.028642; break;
      case 4: scores[0] += -0.007180; scores[1] += 0.007178; scores[2] += -0.004005; scores[3] += 0.004007; break;
      case 5: scores[0] += -0.002864; scores[1] += -0.009019; scores[2] += -0.000703; scores[3] += 0.012585; break;
      case 6: scores[0] += -0.001232; scores[1] += 0.012873; scores[2] += -0.020134; scores[3] += 0.008494; break;
      case 7: scores[0] += -0.000403; scores[1] += 0.011635; scores[2] += -0.007181; scores[3] += -0.004050; break;
    }
  }

  // Tree 254 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008214; scores[1] += 0.004520; scores[2] += 0.000779; scores[3] += 0.002916; break;
      case 1: scores[0] += -0.000036; scores[1] += -0.000191; scores[2] += -0.000945; scores[3] += 0.001172; break;
      case 2: scores[0] += 0.008868; scores[1] += -0.008745; scores[2] += -0.003661; scores[3] += 0.003538; break;
      case 3: scores[0] += -0.000108; scores[1] += -0.000299; scores[2] += 0.018463; scores[3] += -0.018056; break;
      case 4: scores[0] += -0.000122; scores[1] += -0.009866; scores[2] += -0.000377; scores[3] += 0.010365; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000552; scores[1] += -0.000324; scores[2] += 0.024589; scores[3] += -0.023713; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 255 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006585; scores[1] += 0.001520; scores[2] += -0.017849; scores[3] += 0.009743; break;
      case 1: scores[0] += -0.000053; scores[1] += 0.016489; scores[2] += -0.000099; scores[3] += -0.016337; break;
      case 2: scores[0] += 0.003731; scores[1] += -0.017951; scores[2] += 0.011775; scores[3] += 0.002445; break;
      case 3: scores[0] += -0.001163; scores[1] += -0.004941; scores[2] += -0.009211; scores[3] += 0.015315; break;
      case 4: scores[0] += -0.002463; scores[1] += 0.008432; scores[2] += -0.002238; scores[3] += -0.003731; break;
      case 5: scores[0] += -0.000012; scores[1] += -0.037162; scores[2] += -0.000010; scores[3] += 0.037184; break;
      case 6: scores[0] += -0.006836; scores[1] += -0.000002; scores[2] += -0.018776; scores[3] += 0.025614; break;
      case 7: scores[0] += -0.000197; scores[1] += -0.007443; scores[2] += -0.002345; scores[3] += 0.009985; break;
    }
  }

  // Tree 256 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.006747; scores[1] += 0.000632; scores[2] += 0.002244; scores[3] += 0.003871; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.004491; scores[1] += -0.001005; scores[2] += 0.004958; scores[3] += -0.008444; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000690; scores[1] += 0.015985; scores[2] += -0.001784; scores[3] += -0.013510; break;
      case 5: scores[0] += -0.000035; scores[1] += -0.000188; scores[2] += -0.000932; scores[3] += 0.001155; break;
      case 6: scores[0] += -0.003997; scores[1] += -0.007164; scores[2] += -0.028911; scores[3] += 0.040072; break;
      case 7: scores[0] += -0.000108; scores[1] += -0.000296; scores[2] += 0.018333; scores[3] += -0.017930; break;
    }
  }

  // Tree 257 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.366666793823242) << 1) | ((features[37] > 0.10000000149011612) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.025688; scores[1] += 0.010133; scores[2] += 0.005899; scores[3] += 0.009655; break;
      case 1: scores[0] += -0.000120; scores[1] += -0.000045; scores[2] += 0.014441; scores[3] += -0.014276; break;
      case 2: scores[0] += 0.011047; scores[1] += 0.002470; scores[2] += -0.013766; scores[3] += 0.000249; break;
      case 3: scores[0] += -0.000220; scores[1] += -0.005232; scores[2] += 0.008750; scores[3] += -0.003298; break;
      case 4: scores[0] += -0.000766; scores[1] += -0.016342; scores[2] += 0.035198; scores[3] += -0.018090; break;
      case 5: scores[0] += -0.000109; scores[1] += -0.001952; scores[2] += 0.005322; scores[3] += -0.003261; break;
      case 6: scores[0] += -0.001595; scores[1] += -0.011803; scores[2] += 0.019753; scores[3] += -0.006355; break;
      case 7: scores[0] += -0.000334; scores[1] += -0.003274; scores[2] += 0.009196; scores[3] += -0.005589; break;
    }
  }

  // Tree 258 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000077; scores[1] += -0.011379; scores[2] += 0.013196; scores[3] += -0.001740; break;
      case 1: scores[0] += -0.000169; scores[1] += 0.026955; scores[2] += -0.027548; scores[3] += 0.000762; break;
      case 2: scores[0] += -0.002264; scores[1] += 0.010507; scores[2] += -0.000621; scores[3] += -0.007622; break;
      case 3: scores[0] += -0.000038; scores[1] += 0.027478; scores[2] += -0.000039; scores[3] += -0.027401; break;
      case 4: scores[0] += -0.005754; scores[1] += 0.017146; scores[2] += -0.027939; scores[3] += 0.016548; break;
      case 5: scores[0] += -0.000068; scores[1] += 0.020683; scores[2] += -0.000401; scores[3] += -0.020213; break;
      case 6: scores[0] += -0.000001; scores[1] += 0.003726; scores[2] += -0.000006; scores[3] += -0.003719; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.007093; scores[2] += -0.000006; scores[3] += -0.007085; break;
    }
  }

  // Tree 259 (depth=3)
  {
    const leafIdx = ((features[47] > 0.8166666626930237) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006283; scores[1] += 0.005281; scores[2] += -0.017447; scores[3] += 0.005883; break;
      case 1: scores[0] += -0.000010; scores[1] += -0.005875; scores[2] += -0.000005; scores[3] += 0.005890; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.011221; scores[1] += 0.033732; scores[2] += 0.003756; scores[3] += -0.026267; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.003456; scores[1] += -0.026889; scores[2] += 0.003699; scores[3] += 0.026646; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 260 (depth=3)
  {
    const leafIdx = ((features[43] > 0.1913919448852539) << 0) | ((features[10] > 6.550000190734863) << 1) | ((features[30] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.028787; scores[1] += -0.000571; scores[2] += 0.027897; scores[3] += 0.001461; break;
      case 1: scores[0] += -0.000110; scores[1] += -0.000603; scores[2] += -0.000299; scores[3] += 0.001013; break;
      case 2: scores[0] += 0.011816; scores[1] += -0.023645; scores[2] += 0.005113; scores[3] += 0.006717; break;
      case 3: scores[0] += -0.000793; scores[1] += 0.011190; scores[2] += -0.000389; scores[3] += -0.010008; break;
      case 4: scores[0] += -0.000377; scores[1] += 0.045343; scores[2] += -0.000727; scores[3] += -0.044238; break;
      case 5: scores[0] += -0.000129; scores[1] += -0.039631; scores[2] += -0.000078; scores[3] += 0.039838; break;
      case 6: scores[0] += 0.005575; scores[1] += 0.044367; scores[2] += -0.046106; scores[3] += -0.003836; break;
      case 7: scores[0] += -0.000706; scores[1] += -0.036831; scores[2] += -0.000232; scores[3] += 0.037769; break;
    }
  }

  // Tree 261 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.042104; scores[1] += -0.008328; scores[2] += -0.003822; scores[3] += -0.029954; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.005554; scores[1] += -0.007727; scores[2] += -0.001021; scores[3] += 0.014302; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.048489; scores[1] += 0.012304; scores[2] += 0.017702; scores[3] += 0.018483; break;
      case 5: scores[0] += -0.000098; scores[1] += -0.000287; scores[2] += 0.018410; scores[3] += -0.018025; break;
      case 6: scores[0] += -0.004808; scores[1] += 0.017556; scores[2] += -0.023947; scores[3] += 0.011199; break;
      case 7: scores[0] += -0.000032; scores[1] += -0.000178; scores[2] += -0.000891; scores[3] += 0.001100; break;
    }
  }

  // Tree 262 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[34] > 0.550000011920929) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002070; scores[1] += -0.002314; scores[2] += 0.002573; scores[3] += 0.001811; break;
      case 1: scores[0] += 0.013367; scores[1] += -0.000706; scores[2] += -0.000390; scores[3] += -0.012270; break;
      case 2: scores[0] += -0.000097; scores[1] += -0.000284; scores[2] += 0.018024; scores[3] += -0.017643; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.009327; scores[1] += 0.016697; scores[2] += -0.022797; scores[3] += 0.015428; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000032; scores[1] += -0.000177; scores[2] += -0.000889; scores[3] += 0.001098; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 263 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.006969; scores[1] += 0.003659; scores[2] += 0.001249; scores[3] += 0.002061; break;
      case 1: scores[0] += -0.000031; scores[1] += -0.000177; scores[2] += -0.000887; scores[3] += 0.001096; break;
      case 2: scores[0] += 0.006778; scores[1] += -0.007442; scores[2] += -0.003173; scores[3] += 0.003837; break;
      case 3: scores[0] += -0.000096; scores[1] += -0.000282; scores[2] += 0.017652; scores[3] += -0.017273; break;
      case 4: scores[0] += -0.000112; scores[1] += -0.009884; scores[2] += -0.000330; scores[3] += 0.010326; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000512; scores[1] += -0.000303; scores[2] += 0.023971; scores[3] += -0.023156; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 264 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.3207142949104309) << 1) | ((features[0] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001930; scores[1] += 0.017269; scores[2] += -0.009098; scores[3] += -0.006241; break;
      case 1: scores[0] += -0.000376; scores[1] += -0.001535; scores[2] += 0.024885; scores[3] += -0.022974; break;
      case 2: scores[0] += -0.003140; scores[1] += -0.006258; scores[2] += -0.002329; scores[3] += 0.011727; break;
      case 3: scores[0] += -0.000084; scores[1] += -0.007258; scores[2] += -0.000194; scores[3] += 0.007537; break;
      case 4: scores[0] += 0.007508; scores[1] += -0.033275; scores[2] += 0.010958; scores[3] += 0.014809; break;
      case 5: scores[0] += -0.000258; scores[1] += -0.000256; scores[2] += 0.009030; scores[3] += -0.008517; break;
      case 6: scores[0] += -0.000982; scores[1] += -0.017755; scores[2] += -0.000316; scores[3] += 0.019052; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 265 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[2] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006776; scores[1] += -0.006430; scores[2] += 0.004705; scores[3] += -0.005051; break;
      case 1: scores[0] += 0.001443; scores[1] += 0.025490; scores[2] += -0.003146; scores[3] += -0.023786; break;
      case 2: scores[0] += 0.004732; scores[1] += -0.004536; scores[2] += -0.031091; scores[3] += 0.030894; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.010807; scores[1] += -0.000218; scores[2] += 0.016372; scores[3] += -0.005347; break;
      case 5: scores[0] += -0.000004; scores[1] += 0.000235; scores[2] += -0.000011; scores[3] += -0.000220; break;
      case 6: scores[0] += -0.002159; scores[1] += 0.012840; scores[2] += -0.030997; scores[3] += 0.020317; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 266 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[29] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005201; scores[1] += 0.005856; scores[2] += -0.000250; scores[3] += -0.000405; break;
      case 1: scores[0] += 0.013171; scores[1] += -0.000716; scores[2] += -0.000385; scores[3] += -0.012070; break;
      case 2: scores[0] += -0.001682; scores[1] += -0.008625; scores[2] += -0.000833; scores[3] += 0.011140; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000642; scores[1] += 0.021119; scores[2] += -0.000452; scores[3] += -0.020025; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000128; scores[1] += -0.028861; scores[2] += -0.000117; scores[3] += 0.029106; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 267 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 8.225000381469727) << 1) | ((features[11] > 0.08220720291137695) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.023495; scores[1] += 0.007151; scores[2] += 0.012816; scores[3] += 0.003528; break;
      case 1: scores[0] += -0.001857; scores[1] += -0.026024; scores[2] += 0.003090; scores[3] += 0.024791; break;
      case 2: scores[0] += 0.000558; scores[1] += -0.017102; scores[2] += 0.026124; scores[3] += -0.009580; break;
      case 3: scores[0] += -0.000871; scores[1] += -0.000364; scores[2] += -0.027420; scores[3] += 0.028655; break;
      case 4: scores[0] += -0.016548; scores[1] += 0.047046; scores[2] += -0.008286; scores[3] += -0.022212; break;
      case 5: scores[0] += -0.000630; scores[1] += -0.001656; scores[2] += 0.014857; scores[3] += -0.012572; break;
      case 6: scores[0] += 0.035433; scores[1] += -0.019041; scores[2] += -0.035008; scores[3] += 0.018616; break;
      case 7: scores[0] += -0.000057; scores[1] += -0.000002; scores[2] += 0.014050; scores[3] += -0.013991; break;
    }
  }

  // Tree 268 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007095; scores[1] += 0.001512; scores[2] += -0.017657; scores[3] += 0.009050; break;
      case 1: scores[0] += -0.000032; scores[1] += 0.021697; scores[2] += -0.000086; scores[3] += -0.021579; break;
      case 2: scores[0] += 0.002807; scores[1] += -0.017012; scores[2] += 0.011710; scores[3] += 0.002494; break;
      case 3: scores[0] += -0.000856; scores[1] += -0.004623; scores[2] += -0.008902; scores[3] += 0.014381; break;
      case 4: scores[0] += -0.002266; scores[1] += 0.007856; scores[2] += -0.002140; scores[3] += -0.003449; break;
      case 5: scores[0] += -0.000018; scores[1] += -0.038266; scores[2] += -0.000014; scores[3] += 0.038299; break;
      case 6: scores[0] += -0.006501; scores[1] += 0.000258; scores[2] += -0.017901; scores[3] += 0.024143; break;
      case 7: scores[0] += -0.000246; scores[1] += -0.007615; scores[2] += -0.002797; scores[3] += 0.010657; break;
    }
  }

  // Tree 269 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006918; scores[1] += 0.001676; scores[2] += -0.017118; scores[3] += 0.008524; break;
      case 1: scores[0] += -0.000045; scores[1] += 0.015705; scores[2] += -0.000094; scores[3] += -0.015567; break;
      case 2: scores[0] += 0.002882; scores[1] += -0.016542; scores[2] += 0.010992; scores[3] += 0.002668; break;
      case 3: scores[0] += -0.000926; scores[1] += -0.004655; scores[2] += -0.008657; scores[3] += 0.014238; break;
      case 4: scores[0] += -0.002256; scores[1] += 0.007280; scores[2] += -0.002132; scores[3] += -0.002892; break;
      case 5: scores[0] += -0.000010; scores[1] += -0.035815; scores[2] += -0.000009; scores[3] += 0.035834; break;
      case 6: scores[0] += -0.006383; scores[1] += 0.000785; scores[2] += -0.017490; scores[3] += 0.023088; break;
      case 7: scores[0] += -0.000160; scores[1] += -0.007436; scores[2] += -0.002028; scores[3] += 0.009624; break;
    }
  }

  // Tree 270 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[10] > 4.9166669845581055) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004005; scores[1] += -0.011170; scores[2] += 0.011115; scores[3] += -0.003951; break;
      case 1: scores[0] += -0.000002; scores[1] += 0.001256; scores[2] += -0.000012; scores[3] += -0.001242; break;
      case 2: scores[0] += -0.000077; scores[1] += -0.000719; scores[2] += -0.000360; scores[3] += 0.001155; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000842; scores[1] += -0.004503; scores[2] += 0.007135; scores[3] += -0.001790; break;
      case 5: scores[0] += -0.002569; scores[1] += 0.006380; scores[2] += -0.003199; scores[3] += -0.000612; break;
      case 6: scores[0] += -0.005020; scores[1] += 0.018038; scores[2] += -0.028838; scores[3] += 0.015820; break;
      case 7: scores[0] += -0.000157; scores[1] += 0.025370; scores[2] += -0.000169; scores[3] += -0.025043; break;
    }
  }

  // Tree 271 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[34] > 0.550000011920929) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003982; scores[1] += 0.002235; scores[2] += -0.000735; scores[3] += 0.002482; break;
      case 1: scores[0] += 0.006427; scores[1] += -0.000560; scores[2] += -0.000080; scores[3] += -0.005787; break;
      case 2: scores[0] += 0.001841; scores[1] += -0.000047; scores[2] += -0.000022; scores[3] += -0.001772; break;
      case 3: scores[0] += 0.007745; scores[1] += -0.000158; scores[2] += -0.000321; scores[3] += -0.007266; break;
      case 4: scores[0] += -0.000128; scores[1] += -0.000463; scores[2] += 0.016898; scores[3] += -0.016307; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 272 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005284; scores[1] += -0.019645; scores[2] += 0.013552; scores[3] += 0.000809; break;
      case 1: scores[0] += -0.002236; scores[1] += -0.015830; scores[2] += -0.002669; scores[3] += 0.020735; break;
      case 2: scores[0] += -0.005960; scores[1] += 0.061761; scores[2] += -0.042878; scores[3] += -0.012923; break;
      case 3: scores[0] += -0.000146; scores[1] += 0.020465; scores[2] += -0.000162; scores[3] += -0.020157; break;
      case 4: scores[0] += -0.008387; scores[1] += 0.015772; scores[2] += -0.019872; scores[3] += 0.012487; break;
      case 5: scores[0] += -0.000126; scores[1] += 0.025282; scores[2] += -0.000088; scores[3] += -0.025068; break;
      case 6: scores[0] += -0.000426; scores[1] += -0.017534; scores[2] += -0.003123; scores[3] += 0.021083; break;
      case 7: scores[0] += -0.000009; scores[1] += 0.007044; scores[2] += -0.000006; scores[3] += -0.007029; break;
    }
  }

  // Tree 273 (depth=3)
  {
    const leafIdx = ((features[13] > 0.41801074147224426) << 0) | ((features[14] > 0.5) << 1) | ((features[43] > 0.134848490357399) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001013; scores[1] += -0.001260; scores[2] += -0.000276; scores[3] += 0.000523; break;
      case 1: scores[0] += -0.000625; scores[1] += -0.038431; scores[2] += -0.000745; scores[3] += 0.039801; break;
      case 2: scores[0] += -0.000580; scores[1] += 0.043929; scores[2] += -0.000328; scores[3] += -0.043021; break;
      case 3: scores[0] += -0.001731; scores[1] += 0.010891; scores[2] += -0.000769; scores[3] += -0.008391; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001833; scores[1] += -0.007559; scores[2] += -0.000923; scores[3] += 0.010315; break;
      case 7: scores[0] += -0.000573; scores[1] += -0.018559; scores[2] += -0.000288; scores[3] += 0.019420; break;
    }
  }

  // Tree 274 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[10] > 13.833333969116211) << 1) | ((features[13] > 0.46049895882606506) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.012089; scores[1] += 0.006618; scores[2] += 0.002329; scores[3] += 0.003142; break;
      case 1: scores[0] += -0.000296; scores[1] += 0.020795; scores[2] += -0.000136; scores[3] += -0.020363; break;
      case 2: scores[0] += 0.024945; scores[1] += -0.003483; scores[2] += -0.003093; scores[3] += -0.018370; break;
      case 3: scores[0] += -0.001267; scores[1] += -0.011237; scores[2] += -0.000267; scores[3] += 0.012771; break;
      case 4: scores[0] += -0.001448; scores[1] += -0.013214; scores[2] += -0.001266; scores[3] += 0.015928; break;
      case 5: scores[0] += -0.000019; scores[1] += 0.030799; scores[2] += -0.000016; scores[3] += -0.030764; break;
      case 6: scores[0] += -0.000952; scores[1] += -0.011658; scores[2] += -0.000168; scores[3] += 0.012779; break;
      case 7: scores[0] += -0.000126; scores[1] += 0.000346; scores[2] += -0.000056; scores[3] += -0.000164; break;
    }
  }

  // Tree 275 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.18634259700775146) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003042; scores[1] += -0.012737; scores[2] += 0.005969; scores[3] += 0.003726; break;
      case 1: scores[0] += -0.003731; scores[1] += 0.022986; scores[2] += -0.015293; scores[3] += -0.003962; break;
      case 2: scores[0] += -0.004408; scores[1] += 0.006899; scores[2] += -0.002145; scores[3] += -0.000346; break;
      case 3: scores[0] += -0.000039; scores[1] += 0.017387; scores[2] += -0.000069; scores[3] += -0.017279; break;
      case 4: scores[0] += 0.000267; scores[1] += -0.001776; scores[2] += -0.000377; scores[3] += 0.001886; break;
      case 5: scores[0] += 0.005084; scores[1] += -0.003726; scores[2] += -0.014638; scores[3] += 0.013280; break;
      case 6: scores[0] += -0.000057; scores[1] += -0.000946; scores[2] += -0.000010; scores[3] += 0.001013; break;
      case 7: scores[0] += -0.000041; scores[1] += 0.039706; scores[2] += -0.000034; scores[3] += -0.039631; break;
    }
  }

  // Tree 276 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006744; scores[1] += 0.003705; scores[2] += -0.017434; scores[3] += 0.006985; break;
      case 1: scores[0] += -0.000030; scores[1] += 0.020819; scores[2] += -0.000078; scores[3] += -0.020711; break;
      case 2: scores[0] += 0.003181; scores[1] += -0.015878; scores[2] += 0.009762; scores[3] += 0.002935; break;
      case 3: scores[0] += -0.000828; scores[1] += -0.005011; scores[2] += -0.006212; scores[3] += 0.012050; break;
      case 4: scores[0] += -0.002120; scores[1] += 0.006720; scores[2] += -0.002004; scores[3] += -0.002597; break;
      case 5: scores[0] += -0.000017; scores[1] += -0.035006; scores[2] += -0.000013; scores[3] += 0.035037; break;
      case 6: scores[0] += -0.006084; scores[1] += 0.000725; scores[2] += -0.016843; scores[3] += 0.022202; break;
      case 7: scores[0] += -0.000228; scores[1] += -0.007097; scores[2] += -0.002587; scores[3] += 0.009912; break;
    }
  }

  // Tree 277 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000450; scores[1] += -0.008531; scores[2] += 0.010276; scores[3] += -0.002195; break;
      case 1: scores[0] += -0.001279; scores[1] += 0.042733; scores[2] += -0.029032; scores[3] += -0.012422; break;
      case 2: scores[0] += -0.004746; scores[1] += 0.011560; scores[2] += -0.024603; scores[3] += 0.017789; break;
      case 3: scores[0] += -0.000058; scores[1] += 0.023463; scores[2] += -0.000376; scores[3] += -0.023029; break;
      case 4: scores[0] += -0.002152; scores[1] += 0.004399; scores[2] += -0.001717; scores[3] += -0.000531; break;
      case 5: scores[0] += -0.000381; scores[1] += 0.004526; scores[2] += -0.001468; scores[3] += -0.002677; break;
      case 6: scores[0] += -0.000153; scores[1] += 0.022368; scores[2] += -0.000163; scores[3] += -0.022052; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.003658; scores[2] += -0.000003; scores[3] += -0.003654; break;
    }
  }

  // Tree 278 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[9] > 5.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003785; scores[1] += 0.008504; scores[2] += -0.016824; scores[3] += 0.004535; break;
      case 1: scores[0] += 0.001401; scores[1] += 0.021989; scores[2] += -0.003042; scores[3] += -0.020348; break;
      case 2: scores[0] += -0.000047; scores[1] += -0.017789; scores[2] += -0.000089; scores[3] += 0.017924; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.001975; scores[1] += -0.016695; scores[2] += 0.008540; scores[3] += 0.006180; break;
      case 5: scores[0] += -0.000051; scores[1] += 0.005786; scores[2] += -0.000178; scores[3] += -0.005557; break;
      case 6: scores[0] += -0.000976; scores[1] += -0.010369; scores[2] += -0.004509; scores[3] += 0.015853; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 279 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[10] > 4.9166669845581055) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004436; scores[1] += -0.009409; scores[2] += 0.004396; scores[3] += 0.000578; break;
      case 1: scores[0] += -0.000003; scores[1] += -0.021181; scores[2] += -0.000003; scores[3] += 0.021187; break;
      case 2: scores[0] += 0.002496; scores[1] += -0.001007; scores[2] += -0.003127; scores[3] += 0.001637; break;
      case 3: scores[0] += -0.000198; scores[1] += -0.008274; scores[2] += -0.001686; scores[3] += 0.010157; break;
      case 4: scores[0] += -0.000310; scores[1] += 0.013862; scores[2] += 0.007420; scores[3] += -0.020972; break;
      case 5: scores[0] += -0.000023; scores[1] += 0.000109; scores[2] += -0.000096; scores[3] += 0.000010; break;
      case 6: scores[0] += -0.009857; scores[1] += 0.015926; scores[2] += 0.008861; scores[3] += -0.014930; break;
      case 7: scores[0] += -0.000849; scores[1] += -0.003882; scores[2] += -0.004946; scores[3] += 0.009677; break;
    }
  }

  // Tree 280 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.1270161271095276) << 1) | ((features[11] > 0.05334281921386719) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002518; scores[1] += 0.016997; scores[2] += -0.011174; scores[3] += -0.003306; break;
      case 1: scores[0] += -0.000276; scores[1] += -0.000101; scores[2] += 0.020522; scores[3] += -0.020145; break;
      case 2: scores[0] += -0.002325; scores[1] += -0.002654; scores[2] += -0.002249; scores[3] += 0.007227; break;
      case 3: scores[0] += -0.000079; scores[1] += -0.006738; scores[2] += -0.000188; scores[3] += 0.007005; break;
      case 4: scores[0] += 0.004445; scores[1] += -0.003932; scores[2] += -0.001226; scores[3] += 0.000713; break;
      case 5: scores[0] += -0.000230; scores[1] += -0.001308; scores[2] += 0.012001; scores[3] += -0.010464; break;
      case 6: scores[0] += -0.005305; scores[1] += 0.001111; scores[2] += -0.003674; scores[3] += 0.007868; break;
      case 7: scores[0] += -0.000067; scores[1] += -0.000189; scores[2] += -0.000109; scores[3] += 0.000365; break;
    }
  }

  // Tree 281 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000171; scores[1] += -0.007067; scores[2] += 0.009363; scores[3] += -0.002467; break;
      case 1: scores[0] += -0.002123; scores[1] += 0.003349; scores[2] += -0.001650; scores[3] += 0.000424; break;
      case 2: scores[0] += -0.004647; scores[1] += 0.005642; scores[2] += -0.020992; scores[3] += 0.019997; break;
      case 3: scores[0] += -0.000153; scores[1] += 0.022229; scores[2] += -0.000158; scores[3] += -0.021918; break;
      case 4: scores[0] += -0.001393; scores[1] += 0.041932; scores[2] += -0.028534; scores[3] += -0.012005; break;
      case 5: scores[0] += -0.000382; scores[1] += 0.004636; scores[2] += -0.001466; scores[3] += -0.002788; break;
      case 6: scores[0] += -0.000059; scores[1] += 0.023399; scores[2] += -0.000380; scores[3] += -0.022961; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.003708; scores[2] += -0.000003; scores[3] += -0.003703; break;
    }
  }

  // Tree 282 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[11] > 0.08759590983390808) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003532; scores[1] += -0.003618; scores[2] += 0.009522; scores[3] += -0.002372; break;
      case 1: scores[0] += -0.000011; scores[1] += -0.000095; scores[2] += -0.000160; scores[3] += 0.000266; break;
      case 2: scores[0] += -0.011752; scores[1] += -0.003736; scores[2] += 0.009417; scores[3] += 0.006072; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.010220; scores[1] += 0.034220; scores[2] += -0.020273; scores[3] += -0.003726; break;
      case 5: scores[0] += -0.000015; scores[1] += -0.000049; scores[2] += -0.000600; scores[3] += 0.000664; break;
      case 6: scores[0] += 0.027216; scores[1] += -0.002905; scores[2] += -0.029156; scores[3] += 0.004845; break;
      case 7: scores[0] += -0.000095; scores[1] += -0.000298; scores[2] += 0.019200; scores[3] += -0.018807; break;
    }
  }

  // Tree 283 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[25] > 0.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.012551; scores[1] += -0.044169; scores[2] += 0.021930; scores[3] += 0.009688; break;
      case 1: scores[0] += -0.002884; scores[1] += -0.000152; scores[2] += -0.013068; scores[3] += 0.016104; break;
      case 2: scores[0] += -0.007988; scores[1] += 0.019832; scores[2] += -0.016829; scores[3] += 0.004985; break;
      case 3: scores[0] += -0.000300; scores[1] += -0.023841; scores[2] += -0.003825; scores[3] += 0.027966; break;
      case 4: scores[0] += -0.010475; scores[1] += 0.053919; scores[2] += -0.014130; scores[3] += -0.029313; break;
      case 5: scores[0] += -0.000112; scores[1] += -0.000336; scores[2] += 0.023388; scores[3] += -0.022939; break;
      case 6: scores[0] += -0.000486; scores[1] += -0.035583; scores[2] += -0.001907; scores[3] += 0.037976; break;
      case 7: scores[0] += -0.000041; scores[1] += -0.000947; scores[2] += -0.000834; scores[3] += 0.001821; break;
    }
  }

  // Tree 284 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.3693957030773163) << 1) | ((features[43] > 0.3603896200656891) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001717; scores[1] += 0.010117; scores[2] += -0.005638; scores[3] += -0.002762; break;
      case 1: scores[0] += -0.000112; scores[1] += -0.000349; scores[2] += 0.017685; scores[3] += -0.017224; break;
      case 2: scores[0] += -0.002506; scores[1] += -0.006809; scores[2] += -0.001872; scores[3] += 0.011188; break;
      case 3: scores[0] += -0.000011; scores[1] += -0.000095; scores[2] += -0.000160; scores[3] += 0.000266; break;
      case 4: scores[0] += -0.000020; scores[1] += 0.024352; scores[2] += -0.000007; scores[3] += -0.024325; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000610; scores[1] += -0.014564; scores[2] += -0.000297; scores[3] += 0.015471; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 285 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[13] > 0.029857397079467773) << 1) | ((features[13] > 0.08012820780277252) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002151; scores[1] += -0.005325; scores[2] += 0.003052; scores[3] += 0.000122; break;
      case 1: scores[0] += -0.001072; scores[1] += 0.009860; scores[2] += -0.008885; scores[3] += 0.000096; break;
      case 2: scores[0] += -0.001312; scores[1] += 0.086747; scores[2] += -0.024765; scores[3] += -0.060670; break;
      case 3: scores[0] += -0.000008; scores[1] += -0.031403; scores[2] += -0.000007; scores[3] += 0.031418; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.007413; scores[1] += 0.003644; scores[2] += -0.007045; scores[3] += 0.010815; break;
      case 7: scores[0] += -0.000044; scores[1] += -0.007704; scores[2] += -0.000216; scores[3] += 0.007964; break;
    }
  }

  // Tree 286 (depth=3)
  {
    const leafIdx = ((features[43] > 0.20416666567325592) << 0) | ((features[22] > 0.5) << 1) | ((features[13] > 0.35857143998146057) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002282; scores[1] += 0.017818; scores[2] += -0.002741; scores[3] += -0.012795; break;
      case 1: scores[0] += -0.000776; scores[1] += -0.009314; scores[2] += -0.000434; scores[3] += 0.010524; break;
      case 2: scores[0] += -0.010131; scores[1] += 0.020797; scores[2] += -0.036753; scores[3] += 0.026086; break;
      case 3: scores[0] += -0.000025; scores[1] += -0.030968; scores[2] += -0.000021; scores[3] += 0.031014; break;
      case 4: scores[0] += -0.002440; scores[1] += -0.002644; scores[2] += -0.001953; scores[3] += 0.007037; break;
      case 5: scores[0] += -0.000683; scores[1] += -0.006336; scores[2] += -0.000331; scores[3] += 0.007351; break;
      case 6: scores[0] += -0.000138; scores[1] += -0.010328; scores[2] += -0.000087; scores[3] += 0.010553; break;
      case 7: scores[0] += -0.000014; scores[1] += -0.013281; scores[2] += -0.000011; scores[3] += 0.013305; break;
    }
  }

  // Tree 287 (depth=3)
  {
    const leafIdx = ((features[10] > 7.550000190734863) << 0) | ((features[26] > 0.5) << 1) | ((features[10] > 9.291666030883789) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.032653; scores[1] += 0.003584; scores[2] += 0.025111; scores[3] += 0.003958; break;
      case 1: scores[0] += 0.000079; scores[1] += 0.006509; scores[2] += -0.016519; scores[3] += 0.009931; break;
      case 2: scores[0] += -0.000047; scores[1] += 0.036559; scores[2] += -0.000059; scores[3] += -0.036452; break;
      case 3: scores[0] += -0.000099; scores[1] += -0.009428; scores[2] += -0.000034; scores[3] += 0.009560; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.025778; scores[1] += -0.026131; scores[2] += -0.001186; scores[3] += 0.001540; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.001743; scores[1] += 0.015299; scores[2] += -0.000407; scores[3] += -0.013148; break;
    }
  }

  // Tree 288 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005562; scores[1] += 0.003903; scores[2] += -0.000347; scores[3] += 0.002006; break;
      case 1: scores[0] += -0.000026; scores[1] += -0.000143; scores[2] += -0.000787; scores[3] += 0.000955; break;
      case 2: scores[0] += 0.006448; scores[1] += -0.007350; scores[2] += -0.003521; scores[3] += 0.004424; break;
      case 3: scores[0] += -0.000089; scores[1] += -0.000296; scores[2] += 0.017694; scores[3] += -0.017309; break;
      case 4: scores[0] += -0.000089; scores[1] += -0.009520; scores[2] += -0.000264; scores[3] += 0.009873; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000440; scores[1] += -0.000269; scores[2] += 0.022488; scores[3] += -0.021779; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 289 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004605; scores[1] += 0.001939; scores[2] += 0.000776; scores[3] += 0.001890; break;
      case 1: scores[0] += 0.006402; scores[1] += -0.000543; scores[2] += -0.000083; scores[3] += -0.005776; break;
      case 2: scores[0] += 0.001718; scores[1] += -0.000041; scores[2] += -0.000022; scores[3] += -0.001655; break;
      case 3: scores[0] += 0.007262; scores[1] += -0.000139; scores[2] += -0.000319; scores[3] += -0.006804; break;
      case 4: scores[0] += -0.000023; scores[1] += 0.007105; scores[2] += -0.000113; scores[3] += -0.006969; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 290 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000602; scores[1] += -0.010074; scores[2] += 0.010511; scores[3] += -0.001039; break;
      case 1: scores[0] += 0.000201; scores[1] += 0.023390; scores[2] += -0.025683; scores[3] += 0.002093; break;
      case 2: scores[0] += -0.001778; scores[1] += 0.010296; scores[2] += -0.000458; scores[3] += -0.008060; break;
      case 3: scores[0] += -0.000027; scores[1] += 0.024731; scores[2] += -0.000025; scores[3] += -0.024678; break;
      case 4: scores[0] += -0.004703; scores[1] += 0.015875; scores[2] += -0.024721; scores[3] += 0.013549; break;
      case 5: scores[0] += -0.000055; scores[1] += 0.019437; scores[2] += -0.000363; scores[3] += -0.019019; break;
      case 6: scores[0] += -0.000001; scores[1] += 0.003369; scores[2] += -0.000004; scores[3] += -0.003363; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.006887; scores[2] += -0.000005; scores[3] += -0.006881; break;
    }
  }

  // Tree 291 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[9] > 5.5) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000922; scores[1] += -0.010540; scores[2] += 0.012776; scores[3] += -0.003158; break;
      case 1: scores[0] += -0.002878; scores[1] += -0.000205; scores[2] += -0.010462; scores[3] += 0.013545; break;
      case 2: scores[0] += -0.000690; scores[1] += 0.016030; scores[2] += -0.023495; scores[3] += 0.008156; break;
      case 3: scores[0] += -0.000088; scores[1] += -0.000303; scores[2] += 0.017744; scores[3] += -0.017353; break;
      case 4: scores[0] += -0.008061; scores[1] += 0.018520; scores[2] += -0.018151; scores[3] += 0.007692; break;
      case 5: scores[0] += -0.000186; scores[1] += -0.023280; scores[2] += -0.002823; scores[3] += 0.026288; break;
      case 6: scores[0] += -0.000037; scores[1] += -0.034137; scores[2] += -0.000060; scores[3] += 0.034233; break;
      case 7: scores[0] += -0.000173; scores[1] += -0.000932; scores[2] += -0.002271; scores[3] += 0.003376; break;
    }
  }

  // Tree 292 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.027402402833104134) << 1) | ((features[17] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003139; scores[1] += -0.003118; scores[2] += -0.002396; scores[3] += 0.002375; break;
      case 1: scores[0] += -0.000088; scores[1] += -0.000301; scores[2] += 0.017381; scores[3] += -0.016993; break;
      case 2: scores[0] += -0.007694; scores[1] += 0.014914; scores[2] += -0.019110; scores[3] += 0.011891; break;
      case 3: scores[0] += -0.000025; scores[1] += -0.000142; scores[2] += -0.000752; scores[3] += 0.000919; break;
      case 4: scores[0] += -0.000458; scores[1] += -0.001300; scores[2] += 0.027159; scores[3] += -0.025402; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000130; scores[1] += -0.006630; scores[2] += -0.000268; scores[3] += 0.007027; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 293 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 11.291666030883789) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.010051; scores[1] += 0.003116; scores[2] += 0.004236; scores[3] += 0.002700; break;
      case 1: scores[0] += -0.011665; scores[1] += 0.006567; scores[2] += -0.027959; scores[3] += 0.033058; break;
      case 2: scores[0] += -0.009172; scores[1] += 0.003965; scores[2] += 0.010726; scores[3] += -0.005519; break;
      case 3: scores[0] += -0.001782; scores[1] += 0.013575; scores[2] += -0.040240; scores[3] += 0.028447; break;
      case 4: scores[0] += 0.030439; scores[1] += -0.010317; scores[2] += -0.003615; scores[3] += -0.016508; break;
      case 5: scores[0] += 0.012679; scores[1] += -0.014106; scores[2] += -0.008788; scores[3] += 0.010215; break;
      case 6: scores[0] += -0.000517; scores[1] += -0.001863; scores[2] += 0.027627; scores[3] += -0.025247; break;
      case 7: scores[0] += -0.000345; scores[1] += -0.000625; scores[2] += 0.016973; scores[3] += -0.016002; break;
    }
  }

  // Tree 294 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[10] > 5.775000095367432) << 1) | ((features[10] > 5.7083330154418945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009321; scores[1] += -0.008611; scores[2] += 0.021177; scores[3] += -0.003245; break;
      case 1: scores[0] += 0.004392; scores[1] += -0.000491; scores[2] += -0.000063; scores[3] += -0.003838; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000355; scores[1] += -0.018942; scores[2] += 0.000338; scores[3] += 0.018959; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001766; scores[1] += 0.006441; scores[2] += -0.005132; scores[3] += 0.000457; break;
      case 7: scores[0] += 0.008668; scores[1] += -0.000171; scores[2] += -0.000331; scores[3] += -0.008166; break;
    }
  }

  // Tree 295 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[34] > 0.3500000238418579) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002876; scores[1] += -0.010665; scores[2] += 0.020783; scores[3] += -0.007242; break;
      case 1: scores[0] += -0.002221; scores[1] += 0.038221; scores[2] += -0.016849; scores[3] += -0.019150; break;
      case 2: scores[0] += -0.003926; scores[1] += 0.026110; scores[2] += -0.041714; scores[3] += 0.019530; break;
      case 3: scores[0] += -0.000057; scores[1] += 0.025204; scores[2] += -0.000390; scores[3] += -0.024757; break;
      case 4: scores[0] += -0.002348; scores[1] += -0.018093; scores[2] += -0.002959; scores[3] += 0.023400; break;
      case 5: scores[0] += -0.000253; scores[1] += -0.000623; scores[2] += -0.012156; scores[3] += 0.013032; break;
      case 6: scores[0] += -0.000456; scores[1] += -0.012571; scores[2] += 0.020347; scores[3] += -0.007320; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 296 (depth=3)
  {
    const leafIdx = ((features[14] > 0.5) << 0) | ((features[27] > 0.5) << 1) | ((features[11] > 0.023532669991254807) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.010109; scores[1] += 0.001818; scores[2] += -0.026844; scores[3] += 0.014918; break;
      case 1: scores[0] += -0.001000; scores[1] += 0.011597; scores[2] += -0.000680; scores[3] += -0.009917; break;
      case 2: scores[0] += -0.000033; scores[1] += -0.001488; scores[2] += 0.016291; scores[3] += -0.014770; break;
      case 3: scores[0] += -0.000061; scores[1] += -0.016931; scores[2] += -0.000040; scores[3] += 0.017032; break;
      case 4: scores[0] += 0.004255; scores[1] += -0.020033; scores[2] += 0.005797; scores[3] += 0.009982; break;
      case 5: scores[0] += -0.002544; scores[1] += -0.004995; scores[2] += -0.001090; scores[3] += 0.008629; break;
      case 6: scores[0] += -0.000630; scores[1] += -0.000057; scores[2] += 0.026629; scores[3] += -0.025942; break;
      case 7: scores[0] += -0.000308; scores[1] += -0.005792; scores[2] += -0.000134; scores[3] += 0.006233; break;
    }
  }

  // Tree 297 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[35] > 0.5) << 1) | ((features[44] > 0.15000000596046448) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.035545; scores[1] += -0.019676; scores[2] += -0.004477; scores[3] += -0.011392; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.024774; scores[1] += -0.000374; scores[2] += -0.000071; scores[3] += -0.024330; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.037940; scores[1] += 0.017512; scores[2] += 0.004106; scores[3] += 0.016321; break;
      case 5: scores[0] += -0.009338; scores[1] += -0.000626; scores[2] += 0.017221; scores[3] += -0.007257; break;
      case 6: scores[0] += -0.019600; scores[1] += 0.019406; scores[2] += -0.026113; scores[3] += 0.026306; break;
      case 7: scores[0] += -0.001467; scores[1] += 0.019621; scores[2] += -0.040210; scores[3] += 0.022056; break;
    }
  }

  // Tree 298 (depth=3)
  {
    const leafIdx = ((features[13] > 0.23904761672019958) << 0) | ((features[10] > 6.449999809265137) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.028600; scores[1] += 0.021350; scores[2] += 0.021471; scores[3] += -0.014220; break;
      case 1: scores[0] += -0.000068; scores[1] += -0.042758; scores[2] += -0.000079; scores[3] += 0.042905; break;
      case 2: scores[0] += 0.019535; scores[1] += 0.003556; scores[2] += -0.020101; scores[3] += -0.002990; break;
      case 3: scores[0] += -0.002299; scores[1] += -0.016407; scores[2] += -0.000529; scores[3] += 0.019235; break;
      case 4: scores[0] += -0.001826; scores[1] += -0.015406; scores[2] += 0.014272; scores[3] += 0.002960; break;
      case 5: scores[0] += -0.000275; scores[1] += 0.005430; scores[2] += -0.000740; scores[3] += -0.004414; break;
      case 6: scores[0] += -0.000470; scores[1] += 0.009082; scores[2] += -0.006967; scores[3] += -0.001644; break;
      case 7: scores[0] += -0.002460; scores[1] += 0.008216; scores[2] += -0.001693; scores[3] += -0.004064; break;
    }
  }

  // Tree 299 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009719; scores[1] += -0.006110; scores[2] += 0.000550; scores[3] += -0.004159; break;
      case 1: scores[0] += 0.004914; scores[1] += -0.003635; scores[2] += -0.030807; scores[3] += 0.029528; break;
      case 2: scores[0] += -0.008001; scores[1] += -0.009298; scores[2] += 0.021099; scores[3] += -0.003800; break;
      case 3: scores[0] += -0.001777; scores[1] += -0.000069; scores[2] += -0.023616; scores[3] += 0.025462; break;
      case 4: scores[0] += -0.005504; scores[1] += 0.004772; scores[2] += -0.002864; scores[3] += 0.003596; break;
      case 5: scores[0] += -0.002134; scores[1] += -0.006758; scores[2] += -0.000412; scores[3] += 0.009304; break;
      case 6: scores[0] += -0.000942; scores[1] += 0.013256; scores[2] += -0.017098; scores[3] += 0.004784; break;
      case 7: scores[0] += -0.000338; scores[1] += 0.010999; scores[2] += -0.004848; scores[3] += -0.005813; break;
    }
  }

  // Tree 300 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000442; scores[1] += -0.009709; scores[2] += 0.009856; scores[3] += -0.000588; break;
      case 1: scores[0] += 0.000475; scores[1] += 0.021814; scores[2] += -0.023939; scores[3] += 0.001650; break;
      case 2: scores[0] += -0.004423; scores[1] += 0.016559; scores[2] += -0.025048; scores[3] += 0.012912; break;
      case 3: scores[0] += -0.000051; scores[1] += 0.019060; scores[2] += -0.000390; scores[3] += -0.018619; break;
      case 4: scores[0] += -0.001791; scores[1] += 0.009349; scores[2] += -0.000435; scores[3] += -0.007123; break;
      case 5: scores[0] += -0.000023; scores[1] += 0.024019; scores[2] += -0.000022; scores[3] += -0.023974; break;
      case 6: scores[0] += -0.000001; scores[1] += 0.003165; scores[2] += -0.000004; scores[3] += -0.003160; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.006795; scores[2] += -0.000005; scores[3] += -0.006789; break;
    }
  }

  // Tree 301 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008956; scores[1] += -0.005077; scores[2] += 0.000023; scores[3] += -0.003902; break;
      case 1: scores[0] += 0.005459; scores[1] += -0.003598; scores[2] += -0.030324; scores[3] += 0.028463; break;
      case 2: scores[0] += -0.007828; scores[1] += -0.009201; scores[2] += 0.019814; scores[3] += -0.002784; break;
      case 3: scores[0] += -0.001760; scores[1] += -0.000069; scores[2] += -0.022164; scores[3] += 0.023992; break;
      case 4: scores[0] += -0.005467; scores[1] += 0.004858; scores[2] += -0.002866; scores[3] += 0.003476; break;
      case 5: scores[0] += -0.002118; scores[1] += -0.006653; scores[2] += -0.000412; scores[3] += 0.009183; break;
      case 6: scores[0] += -0.000935; scores[1] += 0.013083; scores[2] += -0.016862; scores[3] += 0.004713; break;
      case 7: scores[0] += -0.000338; scores[1] += 0.010833; scores[2] += -0.004879; scores[3] += -0.005615; break;
    }
  }

  // Tree 302 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 7.449999809265137) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.030363; scores[1] += 0.011979; scores[2] += 0.019096; scores[3] += -0.000711; break;
      case 1: scores[0] += -0.000898; scores[1] += -0.000383; scores[2] += 0.013860; scores[3] += -0.012579; break;
      case 2: scores[0] += 0.024057; scores[1] += -0.036346; scores[2] += 0.005960; scores[3] += 0.006329; break;
      case 3: scores[0] += -0.001866; scores[1] += -0.000071; scores[2] += -0.019279; scores[3] += 0.021216; break;
      case 4: scores[0] += -0.001312; scores[1] += 0.005640; scores[2] += -0.005318; scores[3] += 0.000990; break;
      case 5: scores[0] += -0.000248; scores[1] += -0.022265; scores[2] += -0.003840; scores[3] += 0.026354; break;
      case 6: scores[0] += -0.006714; scores[1] += 0.012741; scores[2] += -0.013872; scores[3] += 0.007845; break;
      case 7: scores[0] += -0.000063; scores[1] += -0.001850; scores[2] += -0.000494; scores[3] += 0.002408; break;
    }
  }

  // Tree 303 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[13] > 0.7871376872062683) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007693; scores[1] += -0.001913; scores[2] += 0.002665; scores[3] += -0.008445; break;
      case 1: scores[0] += -0.006357; scores[1] += -0.001379; scores[2] += -0.029763; scores[3] += 0.037499; break;
      case 2: scores[0] += -0.022588; scores[1] += 0.053735; scores[2] += -0.024078; scores[3] += -0.007069; break;
      case 3: scores[0] += -0.000005; scores[1] += 0.025803; scores[2] += -0.000002; scores[3] += -0.025796; break;
      case 4: scores[0] += -0.001051; scores[1] += -0.029718; scores[2] += -0.000240; scores[3] += 0.031009; break;
      case 5: scores[0] += -0.000013; scores[1] += -0.007825; scores[2] += -0.000008; scores[3] += 0.007845; break;
      case 6: scores[0] += -0.000150; scores[1] += -0.032798; scores[2] += -0.000098; scores[3] += 0.033046; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 304 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000299; scores[1] += -0.008728; scores[2] += 0.009259; scores[3] += -0.000231; break;
      case 1: scores[0] += 0.000605; scores[1] += 0.020929; scores[2] += -0.023480; scores[3] += 0.001947; break;
      case 2: scores[0] += -0.004340; scores[1] += 0.016076; scores[2] += -0.025036; scores[3] += 0.013300; break;
      case 3: scores[0] += -0.000051; scores[1] += 0.018891; scores[2] += -0.000400; scores[3] += -0.018439; break;
      case 4: scores[0] += -0.001765; scores[1] += 0.008188; scores[2] += -0.000425; scores[3] += -0.005997; break;
      case 5: scores[0] += -0.000023; scores[1] += 0.023604; scores[2] += -0.000021; scores[3] += -0.023560; break;
      case 6: scores[0] += -0.000001; scores[1] += 0.003100; scores[2] += -0.000004; scores[3] += -0.003095; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.006743; scores[2] += -0.000005; scores[3] += -0.006737; break;
    }
  }

  // Tree 305 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004676; scores[1] += 0.002641; scores[2] += -0.000372; scores[3] += 0.002407; break;
      case 1: scores[0] += 0.005990; scores[1] += -0.000517; scores[2] += -0.000087; scores[3] += -0.005386; break;
      case 2: scores[0] += 0.001483; scores[1] += -0.000033; scores[2] += -0.000019; scores[3] += -0.001431; break;
      case 3: scores[0] += 0.006320; scores[1] += -0.000109; scores[2] += -0.000289; scores[3] += -0.005922; break;
      case 4: scores[0] += -0.000021; scores[1] += 0.007336; scores[2] += -0.000119; scores[3] += -0.007196; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 306 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.013238; scores[1] += -0.038438; scores[2] += 0.010820; scores[3] += 0.014380; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.007348; scores[1] += 0.017884; scores[2] += -0.018301; scores[3] += 0.007765; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.009814; scores[1] += 0.050174; scores[2] += -0.011485; scores[3] += -0.028875; break;
      case 5: scores[0] += -0.000077; scores[1] += -0.000268; scores[2] += 0.015953; scores[3] += -0.015608; break;
      case 6: scores[0] += -0.000397; scores[1] += -0.034489; scores[2] += -0.001819; scores[3] += 0.036705; break;
      case 7: scores[0] += -0.000023; scores[1] += -0.000136; scores[2] += -0.000720; scores[3] += 0.000879; break;
    }
  }

  // Tree 307 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.550000190734863) << 1) | ((features[46] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.025083; scores[1] += 0.008702; scores[2] += 0.010219; scores[3] += 0.006162; break;
      case 1: scores[0] += -0.000094; scores[1] += -0.000036; scores[2] += 0.013457; scores[3] += -0.013327; break;
      case 2: scores[0] += 0.011757; scores[1] += 0.000825; scores[2] += -0.014009; scores[3] += 0.001426; break;
      case 3: scores[0] += -0.000356; scores[1] += -0.006951; scores[2] += 0.012719; scores[3] += -0.005411; break;
      case 4: scores[0] += -0.000437; scores[1] += -0.005845; scores[2] += 0.022847; scores[3] += -0.016565; break;
      case 5: scores[0] += -0.000066; scores[1] += -0.001515; scores[2] += 0.003891; scores[3] += -0.002310; break;
      case 6: scores[0] += -0.000895; scores[1] += 0.000170; scores[2] += 0.015291; scores[3] += -0.014566; break;
      case 7: scores[0] += -0.000052; scores[1] += -0.000222; scores[2] += 0.000544; scores[3] += -0.000270; break;
    }
  }

  // Tree 308 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[10] > 4.9166669845581055) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004646; scores[1] += -0.009131; scores[2] += 0.004011; scores[3] += 0.000474; break;
      case 1: scores[0] += -0.000002; scores[1] += -0.020612; scores[2] += -0.000002; scores[3] += 0.020617; break;
      case 2: scores[0] += 0.000658; scores[1] += 0.000017; scores[2] += -0.002134; scores[3] += 0.001459; break;
      case 3: scores[0] += -0.000157; scores[1] += -0.007768; scores[2] += -0.001350; scores[3] += 0.009274; break;
      case 4: scores[0] += -0.000231; scores[1] += 0.011009; scores[2] += 0.006986; scores[3] += -0.017764; break;
      case 5: scores[0] += -0.000015; scores[1] += -0.000040; scores[2] += -0.000067; scores[3] += 0.000122; break;
      case 6: scores[0] += -0.008986; scores[1] += 0.014546; scores[2] += 0.007073; scores[3] += -0.012633; break;
      case 7: scores[0] += -0.000674; scores[1] += -0.004808; scores[2] += -0.006000; scores[3] += 0.011482; break;
    }
  }

  // Tree 309 (depth=3)
  {
    const leafIdx = ((features[43] > 0.20416666567325592) << 0) | ((features[29] > 0.5) << 1) | ((features[14] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001360; scores[1] += -0.006077; scores[2] += 0.001697; scores[3] += 0.003019; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000032; scores[1] += -0.026920; scores[2] += -0.000016; scores[3] += 0.026969; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.002370; scores[1] += 0.017956; scores[2] += -0.000935; scores[3] += -0.014651; break;
      case 5: scores[0] += -0.001274; scores[1] += -0.008785; scores[2] += -0.000610; scores[3] += 0.010669; break;
      case 6: scores[0] += -0.000495; scores[1] += 0.040666; scores[2] += -0.000372; scores[3] += -0.039800; break;
      case 7: scores[0] += -0.000070; scores[1] += -0.029593; scores[2] += -0.000082; scores[3] += 0.029745; break;
    }
  }

  // Tree 310 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 8.225000381469727) << 1) | ((features[40] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.024955; scores[1] += 0.004656; scores[2] += 0.013665; scores[3] += 0.006635; break;
      case 1: scores[0] += -0.001007; scores[1] += -0.016913; scores[2] += 0.030068; scores[3] += -0.012147; break;
      case 2: scores[0] += 0.022472; scores[1] += -0.028321; scores[2] += 0.014414; scores[3] += -0.008566; break;
      case 3: scores[0] += -0.000259; scores[1] += -0.000160; scores[2] += -0.013791; scores[3] += 0.014210; break;
      case 4: scores[0] += -0.004450; scores[1] += 0.016727; scores[2] += -0.002948; scores[3] += -0.009328; break;
      case 5: scores[0] += -0.001074; scores[1] += -0.013745; scores[2] += -0.016236; scores[3] += 0.031055; break;
      case 6: scores[0] += -0.002997; scores[1] += 0.012169; scores[2] += -0.015007; scores[3] += 0.005835; break;
      case 7: scores[0] += -0.000640; scores[1] += -0.000200; scores[2] += -0.012933; scores[3] += 0.013773; break;
    }
  }

  // Tree 311 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[9] > 5.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005287; scores[1] += 0.003087; scores[2] += 0.001417; scores[3] += 0.000784; break;
      case 1: scores[0] += 0.006020; scores[1] += -0.000500; scores[2] += -0.000089; scores[3] += -0.005431; break;
      case 2: scores[0] += 0.001433; scores[1] += -0.000029; scores[2] += -0.000019; scores[3] += -0.001385; break;
      case 3: scores[0] += 0.006104; scores[1] += -0.000099; scores[2] += -0.000277; scores[3] += -0.005728; break;
      case 4: scores[0] += -0.000720; scores[1] += -0.019748; scores[2] += -0.002869; scores[3] += 0.023338; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 312 (depth=3)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[13] > 0.4749373495578766) << 1) | ((features[13] > 0.47913044691085815) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003191; scores[1] += 0.003282; scores[2] += 0.008237; scores[3] += -0.008327; break;
      case 1: scores[0] += 0.001501; scores[1] += 0.020202; scores[2] += -0.045795; scores[3] += 0.024091; break;
      case 2: scores[0] += -0.000046; scores[1] += 0.004441; scores[2] += -0.000048; scores[3] += -0.004347; break;
      case 3: scores[0] += -0.000001; scores[1] += -0.025830; scores[2] += -0.000001; scores[3] += 0.025832; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001807; scores[1] += -0.015599; scores[2] += -0.001010; scores[3] += 0.018416; break;
      case 7: scores[0] += -0.000063; scores[1] += 0.012217; scores[2] += -0.000068; scores[3] += -0.012087; break;
    }
  }

  // Tree 313 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005891; scores[1] += 0.003550; scores[2] += -0.017060; scores[3] += 0.007619; break;
      case 1: scores[0] += -0.000030; scores[1] += 0.015863; scores[2] += -0.000060; scores[3] += -0.015773; break;
      case 2: scores[0] += 0.002776; scores[1] += -0.017215; scores[2] += 0.010383; scores[3] += 0.004056; break;
      case 3: scores[0] += -0.000668; scores[1] += -0.005684; scores[2] += -0.005370; scores[3] += 0.011723; break;
      case 4: scores[0] += -0.001701; scores[1] += 0.006125; scores[2] += -0.001720; scores[3] += -0.002703; break;
      case 5: scores[0] += -0.000006; scores[1] += -0.030247; scores[2] += -0.000006; scores[3] += 0.030258; break;
      case 6: scores[0] += -0.005465; scores[1] += -0.000615; scores[2] += -0.015579; scores[3] += 0.021659; break;
      case 7: scores[0] += -0.000106; scores[1] += -0.005686; scores[2] += -0.001521; scores[3] += 0.007313; break;
    }
  }

  // Tree 314 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000965; scores[1] += -0.006733; scores[2] += 0.003751; scores[3] += 0.002017; break;
      case 1: scores[0] += -0.000115; scores[1] += 0.032317; scores[2] += -0.024823; scores[3] += -0.007379; break;
      case 2: scores[0] += -0.001666; scores[1] += 0.006271; scores[2] += -0.000383; scores[3] += -0.004222; break;
      case 3: scores[0] += -0.000012; scores[1] += 0.026647; scores[2] += -0.000008; scores[3] += -0.026627; break;
      case 4: scores[0] += -0.002194; scores[1] += 0.010106; scores[2] += -0.001882; scores[3] += -0.006031; break;
      case 5: scores[0] += -0.000301; scores[1] += 0.003006; scores[2] += -0.001469; scores[3] += -0.001235; break;
      case 6: scores[0] += -0.000052; scores[1] += 0.010181; scores[2] += -0.000021; scores[3] += -0.010108; break;
      case 7: scores[0] += -0.000013; scores[1] += 0.003860; scores[2] += -0.000020; scores[3] += -0.003826; break;
    }
  }

  // Tree 315 (depth=3)
  {
    const leafIdx = ((features[47] > 0.7166666984558105) << 0) | ((features[13] > 0.7211111187934875) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002588; scores[1] += 0.004141; scores[2] += 0.000217; scores[3] += -0.001770; break;
      case 1: scores[0] += 0.001917; scores[1] += -0.015209; scores[2] += -0.000059; scores[3] += 0.013351; break;
      case 2: scores[0] += -0.001001; scores[1] += -0.036283; scores[2] += -0.000287; scores[3] += 0.037572; break;
      case 3: scores[0] += -0.000051; scores[1] += -0.001283; scores[2] += -0.000011; scores[3] += 0.001345; break;
      case 4: scores[0] += -0.002134; scores[1] += 0.049665; scores[2] += -0.027991; scores[3] += -0.019540; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 316 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004780; scores[1] += -0.018001; scores[2] += 0.011283; scores[3] += 0.001938; break;
      case 1: scores[0] += -0.002142; scores[1] += -0.013823; scores[2] += -0.002702; scores[3] += 0.018666; break;
      case 2: scores[0] += -0.004856; scores[1] += 0.056879; scores[2] += -0.037923; scores[3] += -0.014100; break;
      case 3: scores[0] += -0.000129; scores[1] += 0.019954; scores[2] += -0.000127; scores[3] += -0.019698; break;
      case 4: scores[0] += -0.007106; scores[1] += 0.014066; scores[2] += -0.017800; scores[3] += 0.010840; break;
      case 5: scores[0] += -0.000094; scores[1] += 0.022593; scores[2] += -0.000064; scores[3] += -0.022435; break;
      case 6: scores[0] += -0.000292; scores[1] += -0.016702; scores[2] += -0.002324; scores[3] += 0.019318; break;
      case 7: scores[0] += -0.000006; scores[1] += 0.005911; scores[2] += -0.000004; scores[3] += -0.005901; break;
    }
  }

  // Tree 317 (depth=3)
  {
    const leafIdx = ((features[13] > 0.2875939905643463) << 0) | ((features[34] > 0.05000000074505806) << 1) | ((features[44] > 0.44999998807907104) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002530; scores[1] += 0.009258; scores[2] += -0.001071; scores[3] += -0.005656; break;
      case 1: scores[0] += -0.001407; scores[1] += -0.027881; scores[2] += -0.000399; scores[3] += 0.029688; break;
      case 2: scores[0] += 0.001360; scores[1] += -0.006024; scores[2] += 0.005637; scores[3] += -0.000973; break;
      case 3: scores[0] += -0.002095; scores[1] += 0.010235; scores[2] += -0.001756; scores[3] += -0.006384; break;
      case 4: scores[0] += -0.000424; scores[1] += 0.041782; scores[2] += -0.000998; scores[3] += -0.040360; break;
      case 5: scores[0] += -0.000027; scores[1] += -0.037306; scores[2] += -0.000026; scores[3] += 0.037360; break;
      case 6: scores[0] += -0.003087; scores[1] += -0.014707; scores[2] += -0.013132; scores[3] += 0.030926; break;
      case 7: scores[0] += -0.000168; scores[1] += 0.007337; scores[2] += -0.000260; scores[3] += -0.006909; break;
    }
  }

  // Tree 318 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000441; scores[1] += -0.005592; scores[2] += 0.007612; scores[3] += -0.001578; break;
      case 1: scores[0] += -0.002067; scores[1] += 0.003380; scores[2] += -0.001725; scores[3] += 0.000412; break;
      case 2: scores[0] += -0.003802; scores[1] += 0.003287; scores[2] += -0.018184; scores[3] += 0.018699; break;
      case 3: scores[0] += -0.000136; scores[1] += 0.021096; scores[2] += -0.000131; scores[3] += -0.020829; break;
      case 4: scores[0] += -0.000521; scores[1] += 0.032574; scores[2] += -0.024433; scores[3] += -0.007619; break;
      case 5: scores[0] += -0.000313; scores[1] += 0.003081; scores[2] += -0.001450; scores[3] += -0.001318; break;
      case 6: scores[0] += -0.000049; scores[1] += 0.021625; scores[2] += -0.000388; scores[3] += -0.021188; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.003130; scores[2] += -0.000002; scores[3] += -0.003127; break;
    }
  }

  // Tree 319 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[10] > 4.9166669845581055) << 1) | ((features[23] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004704; scores[1] += -0.008441; scores[2] += 0.003945; scores[3] += -0.000208; break;
      case 1: scores[0] += -0.000002; scores[1] += -0.019362; scores[2] += -0.000002; scores[3] += 0.019366; break;
      case 2: scores[0] += 0.003765; scores[1] += -0.001773; scores[2] += -0.000822; scores[3] += -0.001170; break;
      case 3: scores[0] += -0.000143; scores[1] += -0.006909; scores[2] += -0.001226; scores[3] += 0.008278; break;
      case 4: scores[0] += -0.000218; scores[1] += 0.010524; scores[2] += 0.006688; scores[3] += -0.016994; break;
      case 5: scores[0] += -0.000013; scores[1] += -0.000159; scores[2] += -0.000057; scores[3] += 0.000229; break;
      case 6: scores[0] += -0.018200; scores[1] += 0.020718; scores[2] += -0.008996; scores[3] += 0.006478; break;
      case 7: scores[0] += -0.000625; scores[1] += -0.004884; scores[2] += -0.003012; scores[3] += 0.008520; break;
    }
  }

  // Tree 320 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[13] > 0.010204081423580647) << 1) | ((features[11] > 0.07229965180158615) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008512; scores[1] += -0.004648; scores[2] += 0.013883; scores[3] += -0.000723; break;
      case 1: scores[0] += -0.001927; scores[1] += -0.000133; scores[2] += -0.021441; scores[3] += 0.023501; break;
      case 2: scores[0] += -0.002804; scores[1] += 0.004823; scores[2] += -0.002834; scores[3] += 0.000815; break;
      case 3: scores[0] += -0.000167; scores[1] += -0.021868; scores[2] += -0.001469; scores[3] += 0.023504; break;
      case 4: scores[0] += 0.011821; scores[1] += 0.000461; scores[2] += -0.007732; scores[3] += -0.004551; break;
      case 5: scores[0] += -0.000738; scores[1] += -0.000308; scores[2] += 0.028158; scores[3] += -0.027112; break;
      case 6: scores[0] += -0.005131; scores[1] += 0.015628; scores[2] += -0.015228; scores[3] += 0.004731; break;
      case 7: scores[0] += -0.000127; scores[1] += -0.001323; scores[2] += -0.003095; scores[3] += 0.004544; break;
    }
  }

  // Tree 321 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.17519181966781616) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002093; scores[1] += -0.002171; scores[2] += 0.004858; scores[3] += -0.000594; break;
      case 1: scores[0] += -0.002456; scores[1] += -0.023034; scores[2] += 0.006008; scores[3] += 0.019481; break;
      case 2: scores[0] += 0.004353; scores[1] += 0.002623; scores[2] += -0.009027; scores[3] += 0.002052; break;
      case 3: scores[0] += -0.000256; scores[1] += -0.000032; scores[2] += -0.011945; scores[3] += 0.012234; break;
      case 4: scores[0] += -0.001707; scores[1] += 0.009078; scores[2] += -0.000402; scores[3] += -0.006969; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000033; scores[1] += 0.026261; scores[2] += -0.000019; scores[3] += -0.026209; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 322 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[13] > 0.010204081423580647) << 1) | ((features[11] > 0.07596154510974884) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.009984; scores[1] += -0.004512; scores[2] += 0.015633; scores[3] += -0.001136; break;
      case 1: scores[0] += -0.002022; scores[1] += -0.000132; scores[2] += -0.015941; scores[3] += 0.018095; break;
      case 2: scores[0] += -0.002831; scores[1] += 0.004464; scores[2] += -0.002854; scores[3] += 0.001221; break;
      case 3: scores[0] += -0.000171; scores[1] += -0.020781; scores[2] += -0.001587; scores[3] += 0.022538; break;
      case 4: scores[0] += 0.015297; scores[1] += 0.000983; scores[2] += -0.014359; scores[3] += -0.001920; break;
      case 5: scores[0] += -0.000613; scores[1] += -0.000297; scores[2] += 0.023220; scores[3] += -0.022310; break;
      case 6: scores[0] += -0.005084; scores[1] += 0.016304; scores[2] += -0.015146; scores[3] += 0.003925; break;
      case 7: scores[0] += -0.000113; scores[1] += -0.001222; scores[2] += -0.002857; scores[3] += 0.004192; break;
    }
  }

  // Tree 323 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009346; scores[1] += -0.003278; scores[2] += -0.003180; scores[3] += -0.002887; break;
      case 1: scores[0] += 0.004183; scores[1] += -0.003494; scores[2] += -0.029326; scores[3] += 0.028636; break;
      case 2: scores[0] += -0.007193; scores[1] += -0.009417; scores[2] += 0.020598; scores[3] += -0.003988; break;
      case 3: scores[0] += -0.001871; scores[1] += -0.000065; scores[2] += -0.022167; scores[3] += 0.024103; break;
      case 4: scores[0] += -0.004974; scores[1] += 0.003996; scores[2] += -0.002566; scores[3] += 0.003545; break;
      case 5: scores[0] += -0.001923; scores[1] += -0.008316; scores[2] += -0.000349; scores[3] += 0.010588; break;
      case 6: scores[0] += -0.000861; scores[1] += 0.014897; scores[2] += -0.015640; scores[3] += 0.001604; break;
      case 7: scores[0] += -0.000318; scores[1] += 0.010042; scores[2] += -0.004411; scores[3] += -0.005312; break;
    }
  }

  // Tree 324 (depth=3)
  {
    const leafIdx = ((features[10] > 5.449999809265137) << 0) | ((features[39] > 0.5) << 1) | ((features[13] > 0.37268519401550293) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001932; scores[1] += -0.009231; scores[2] += 0.004186; scores[3] += 0.006977; break;
      case 1: scores[0] += -0.002506; scores[1] += 0.015498; scores[2] += -0.008967; scores[3] += -0.004025; break;
      case 2: scores[0] += -0.000173; scores[1] += -0.007780; scores[2] += 0.021404; scores[3] += -0.013451; break;
      case 3: scores[0] += -0.000230; scores[1] += -0.004533; scores[2] += 0.002636; scores[3] += 0.002128; break;
      case 4: scores[0] += -0.000126; scores[1] += 0.008151; scores[2] += -0.000224; scores[3] += -0.007801; break;
      case 5: scores[0] += -0.002321; scores[1] += -0.007137; scores[2] += -0.001515; scores[3] += 0.010973; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.000047; scores[1] += -0.005505; scores[2] += -0.000191; scores[3] += 0.005743; break;
    }
  }

  // Tree 325 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.3693957030773163) << 1) | ((features[13] > 0.3771551847457886) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002141; scores[1] += 0.009502; scores[2] += -0.005334; scores[3] += -0.002027; break;
      case 1: scores[0] += -0.000083; scores[1] += -0.000294; scores[2] += 0.015412; scores[3] += -0.015034; break;
      case 2: scores[0] += -0.000058; scores[1] += -0.020973; scores[2] += -0.000027; scores[3] += 0.021057; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.002453; scores[1] += -0.004317; scores[2] += -0.001773; scores[3] += 0.008542; break;
      case 7: scores[0] += -0.000008; scores[1] += -0.000070; scores[2] += -0.000128; scores[3] += 0.000206; break;
    }
  }

  // Tree 326 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[16] > 0.5) << 1) | ((features[10] > 5.366666793823242) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002783; scores[1] += -0.002785; scores[2] += 0.006831; scores[3] += -0.001263; break;
      case 1: scores[0] += -0.000001; scores[1] += 0.000018; scores[2] += -0.000001; scores[3] += -0.000016; break;
      case 2: scores[0] += -0.000114; scores[1] += -0.005511; scores[2] += 0.016758; scores[3] += -0.011132; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.000180; scores[1] += 0.001022; scores[2] += -0.002949; scores[3] += 0.001747; break;
      case 5: scores[0] += 0.000764; scores[1] += 0.023432; scores[2] += -0.002937; scores[3] += -0.021259; break;
      case 6: scores[0] += -0.000223; scores[1] += -0.005107; scores[2] += 0.001336; scores[3] += 0.003994; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 327 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[8] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004458; scores[1] += 0.002056; scores[2] += 0.000502; scores[3] += 0.001900; break;
      case 1: scores[0] += 0.004367; scores[1] += -0.000461; scores[2] += -0.000074; scores[3] += -0.003832; break;
      case 2: scores[0] += 0.001434; scores[1] += -0.000029; scores[2] += -0.000019; scores[3] += -0.001386; break;
      case 3: scores[0] += 0.003617; scores[1] += -0.000047; scores[2] += -0.000159; scores[3] += -0.003412; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.001785; scores[1] += -0.000031; scores[2] += -0.000021; scores[3] += -0.001733; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.002682; scores[1] += -0.000055; scores[2] += -0.000129; scores[3] += -0.002498; break;
    }
  }

  // Tree 328 (depth=3)
  {
    const leafIdx = ((features[10] > 5.775000095367432) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[33] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004330; scores[1] += -0.009864; scores[2] += 0.018056; scores[3] += -0.003862; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000330; scores[1] += -0.005089; scores[2] += -0.000191; scores[3] += 0.005610; break;
      case 3: scores[0] += 0.008330; scores[1] += -0.005806; scores[2] += -0.002321; scores[3] += -0.000204; break;
      case 4: scores[0] += -0.000037; scores[1] += -0.000663; scores[2] += -0.000043; scores[3] += 0.000743; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000002; scores[1] += -0.023869; scores[2] += -0.000003; scores[3] += 0.023874; break;
      case 7: scores[0] += -0.020886; scores[1] += 0.044313; scores[2] += -0.021866; scores[3] += -0.001562; break;
    }
  }

  // Tree 329 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000108; scores[1] += -0.008936; scores[2] += 0.009378; scores[3] += -0.000551; break;
      case 1: scores[0] += 0.000463; scores[1] += 0.017353; scores[2] += -0.022217; scores[3] += 0.004401; break;
      case 2: scores[0] += -0.001669; scores[1] += 0.007673; scores[2] += -0.000378; scores[3] += -0.005625; break;
      case 3: scores[0] += -0.000019; scores[1] += 0.021345; scores[2] += -0.000017; scores[3] += -0.021310; break;
      case 4: scores[0] += -0.003918; scores[1] += 0.015299; scores[2] += -0.022519; scores[3] += 0.011138; break;
      case 5: scores[0] += -0.000049; scores[1] += 0.017944; scores[2] += -0.000383; scores[3] += -0.017513; break;
      case 6: scores[0] += -0.000001; scores[1] += 0.003099; scores[2] += -0.000003; scores[3] += -0.003095; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.006463; scores[2] += -0.000004; scores[3] += -0.006458; break;
    }
  }

  // Tree 330 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004372; scores[1] += 0.002027; scores[2] += 0.000420; scores[3] += 0.001925; break;
      case 1: scores[0] += 0.005945; scores[1] += -0.000484; scores[2] += -0.000096; scores[3] += -0.005365; break;
      case 2: scores[0] += 0.001420; scores[1] += -0.000028; scores[2] += -0.000019; scores[3] += -0.001372; break;
      case 3: scores[0] += 0.005904; scores[1] += -0.000097; scores[2] += -0.000279; scores[3] += -0.005528; break;
      case 4: scores[0] += -0.000018; scores[1] += 0.006790; scores[2] += -0.000121; scores[3] += -0.006650; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 331 (depth=3)
  {
    const leafIdx = ((features[34] > 0.05000000074505806) << 0) | ((features[20] > 0.5) << 1) | ((features[13] > 0.025978408753871918) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.011877; scores[1] += -0.031148; scores[2] += -0.001222; scores[3] += 0.020493; break;
      case 1: scores[0] += 0.003659; scores[1] += -0.002826; scores[2] += 0.000856; scores[3] += -0.001690; break;
      case 2: scores[0] += -0.001278; scores[1] += 0.042933; scores[2] += 0.016838; scores[3] += -0.058494; break;
      case 3: scores[0] += -0.005626; scores[1] += -0.014906; scores[2] += 0.006318; scores[3] += 0.014214; break;
      case 4: scores[0] += -0.003136; scores[1] += 0.000195; scores[2] += -0.001270; scores[3] += 0.004210; break;
      case 5: scores[0] += -0.004313; scores[1] += 0.019901; scores[2] += -0.016714; scores[3] += 0.001126; break;
      case 6: scores[0] += -0.000242; scores[1] += -0.017868; scores[2] += -0.000547; scores[3] += 0.018657; break;
      case 7: scores[0] += -0.000176; scores[1] += -0.030519; scores[2] += -0.001762; scores[3] += 0.032457; break;
    }
  }

  // Tree 332 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 7.7083330154418945) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.029136; scores[1] += 0.008733; scores[2] += 0.016231; scores[3] += 0.004172; break;
      case 1: scores[0] += -0.001133; scores[1] += -0.024170; scores[2] += 0.015250; scores[3] += 0.010053; break;
      case 2: scores[0] += 0.019083; scores[1] += -0.016898; scores[2] += -0.002392; scores[3] += 0.000208; break;
      case 3: scores[0] += -0.001638; scores[1] += -0.000552; scores[2] += -0.014627; scores[3] += 0.016817; break;
      case 4: scores[0] += -0.000033; scores[1] += 0.031433; scores[2] += -0.000044; scores[3] += -0.031356; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001595; scores[1] += 0.004101; scores[2] += -0.000339; scores[3] += -0.002167; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 333 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009258; scores[1] += -0.003621; scores[2] += -0.002762; scores[3] += -0.002875; break;
      case 1: scores[0] += 0.004387; scores[1] += -0.003432; scores[2] += -0.028465; scores[3] += 0.027510; break;
      case 2: scores[0] += -0.007033; scores[1] += -0.009245; scores[2] += 0.020252; scores[3] += -0.003974; break;
      case 3: scores[0] += -0.001895; scores[1] += -0.000065; scores[2] += -0.020177; scores[3] += 0.022138; break;
      case 4: scores[0] += -0.004848; scores[1] += 0.003932; scores[2] += -0.002499; scores[3] += 0.003415; break;
      case 5: scores[0] += -0.001885; scores[1] += -0.008584; scores[2] += -0.000335; scores[3] += 0.010803; break;
      case 6: scores[0] += -0.000837; scores[1] += 0.014329; scores[2] += -0.015086; scores[3] += 0.001595; break;
      case 7: scores[0] += -0.000320; scores[1] += 0.009701; scores[2] += -0.004280; scores[3] += -0.005101; break;
    }
  }

  // Tree 334 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000817; scores[1] += -0.005753; scores[2] += 0.003291; scores[3] += 0.001645; break;
      case 1: scores[0] += -0.000036; scores[1] += 0.027561; scores[2] += -0.022477; scores[3] += -0.005048; break;
      case 2: scores[0] += -0.001560; scores[1] += 0.005055; scores[2] += -0.000349; scores[3] += -0.003146; break;
      case 3: scores[0] += -0.000011; scores[1] += 0.024055; scores[2] += -0.000007; scores[3] += -0.024037; break;
      case 4: scores[0] += -0.002176; scores[1] += 0.009656; scores[2] += -0.001915; scores[3] += -0.005565; break;
      case 5: scores[0] += -0.000304; scores[1] += 0.002575; scores[2] += -0.001342; scores[3] += -0.000929; break;
      case 6: scores[0] += -0.000047; scores[1] += 0.009849; scores[2] += -0.000019; scores[3] += -0.009783; break;
      case 7: scores[0] += -0.000011; scores[1] += 0.003021; scores[2] += -0.000015; scores[3] += -0.002995; break;
    }
  }

  // Tree 335 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 9.875) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.014440; scores[1] += 0.004189; scores[2] += 0.005590; scores[3] += 0.004661; break;
      case 1: scores[0] += -0.010741; scores[1] += 0.006074; scores[2] += -0.019895; scores[3] += 0.024562; break;
      case 2: scores[0] += -0.007311; scores[1] += 0.007943; scores[2] += 0.003123; scores[3] += -0.003755; break;
      case 3: scores[0] += -0.000834; scores[1] += 0.010958; scores[2] += -0.006054; scores[3] += -0.004070; break;
      case 4: scores[0] += 0.028051; scores[1] += -0.004340; scores[2] += -0.011865; scores[3] += -0.011846; break;
      case 5: scores[0] += 0.010735; scores[1] += -0.014877; scores[2] += -0.016022; scores[3] += 0.020164; break;
      case 6: scores[0] += -0.000742; scores[1] += -0.004765; scores[2] += 0.036944; scores[3] += -0.031437; break;
      case 7: scores[0] += -0.001391; scores[1] += -0.001021; scores[2] += -0.023261; scores[3] += 0.025672; break;
    }
  }

  // Tree 336 (depth=3)
  {
    const leafIdx = ((features[42] > 0.5) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[31] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009219; scores[1] += 0.003043; scores[2] += -0.020834; scores[3] += 0.008572; break;
      case 1: scores[0] += -0.001219; scores[1] += -0.000407; scores[2] += 0.042239; scores[3] += -0.040614; break;
      case 2: scores[0] += -0.005902; scores[1] += 0.005879; scores[2] += -0.002281; scores[3] += 0.002304; break;
      case 3: scores[0] += -0.000370; scores[1] += -0.016374; scores[2] += -0.000837; scores[3] += 0.017581; break;
      case 4: scores[0] += -0.005455; scores[1] += -0.000455; scores[2] += 0.005885; scores[3] += 0.000024; break;
      case 5: scores[0] += -0.000198; scores[1] += -0.000049; scores[2] += 0.011665; scores[3] += -0.011419; break;
      case 6: scores[0] += -0.001378; scores[1] += 0.011240; scores[2] += -0.013609; scores[3] += 0.003747; break;
      case 7: scores[0] += -0.000143; scores[1] += -0.008187; scores[2] += -0.003901; scores[3] += 0.012231; break;
    }
  }

  // Tree 337 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.08054053783416748) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.010334; scores[1] += -0.004911; scores[2] += 0.017966; scores[3] += -0.002720; break;
      case 1: scores[0] += -0.002038; scores[1] += -0.000135; scores[2] += -0.013937; scores[3] += 0.016110; break;
      case 2: scores[0] += 0.018547; scores[1] += 0.001451; scores[2] += -0.021249; scores[3] += 0.001251; break;
      case 3: scores[0] += -0.000483; scores[1] += -0.000262; scores[2] += 0.023788; scores[3] += -0.023043; break;
      case 4: scores[0] += -0.002951; scores[1] += 0.005180; scores[2] += -0.005113; scores[3] += 0.002884; break;
      case 5: scores[0] += -0.000175; scores[1] += -0.020357; scores[2] += -0.002125; scores[3] += 0.022657; break;
      case 6: scores[0] += -0.004820; scores[1] += 0.017388; scores[2] += -0.012576; scores[3] += 0.000008; break;
      case 7: scores[0] += -0.000089; scores[1] += -0.001130; scores[2] += -0.001813; scores[3] += 0.003032; break;
    }
  }

  // Tree 338 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[10] > 11.291666030883789) << 1) | ((features[2] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008541; scores[1] += 0.004106; scores[2] += 0.000529; scores[3] += 0.003906; break;
      case 1: scores[0] += -0.007571; scores[1] += 0.005682; scores[2] += 0.007778; scores[3] += -0.005889; break;
      case 2: scores[0] += 0.025851; scores[1] += -0.009023; scores[2] += -0.003198; scores[3] += -0.013631; break;
      case 3: scores[0] += -0.000419; scores[1] += -0.001873; scores[2] += 0.022357; scores[3] += -0.020065; break;
      case 4: scores[0] += -0.009836; scores[1] += 0.004315; scores[2] += -0.023512; scores[3] += 0.029034; break;
      case 5: scores[0] += -0.001829; scores[1] += 0.011609; scores[2] += -0.032638; scores[3] += 0.022857; break;
      case 6: scores[0] += 0.011957; scores[1] += -0.013937; scores[2] += -0.006791; scores[3] += 0.008771; break;
      case 7: scores[0] += -0.000368; scores[1] += -0.000679; scores[2] += 0.018148; scores[3] += -0.017100; break;
    }
  }

  // Tree 339 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.11882352828979492) << 1) | ((features[11] > 0.05334281921386719) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001592; scores[1] += 0.018431; scores[2] += -0.014605; scores[3] += -0.002234; break;
      case 1: scores[0] += -0.000227; scores[1] += -0.000074; scores[2] += 0.018442; scores[3] += -0.018141; break;
      case 2: scores[0] += -0.001746; scores[1] += -0.002351; scores[2] += -0.001746; scores[3] += 0.005842; break;
      case 3: scores[0] += -0.000059; scores[1] += -0.005830; scores[2] += -0.000165; scores[3] += 0.006054; break;
      case 4: scores[0] += 0.004057; scores[1] += -0.007445; scores[2] += 0.001659; scores[3] += 0.001730; break;
      case 5: scores[0] += -0.000162; scores[1] += -0.001112; scores[2] += 0.008696; scores[3] += -0.007421; break;
      case 6: scores[0] += -0.004337; scores[1] += -0.004134; scores[2] += -0.002775; scores[3] += 0.011245; break;
      case 7: scores[0] += -0.000051; scores[1] += -0.000198; scores[2] += -0.000086; scores[3] += 0.000334; break;
    }
  }

  // Tree 340 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[10] > 3.450000047683716) << 1) | ((features[10] > 11.291666030883789) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000008; scores[1] += 0.000139; scores[2] += -0.000008; scores[3] += -0.000123; break;
      case 1: scores[0] += -0.000001; scores[1] += 0.006210; scores[2] += -0.000004; scores[3] += -0.006205; break;
      case 2: scores[0] += -0.011684; scores[1] += 0.010347; scores[2] += -0.009725; scores[3] += 0.011062; break;
      case 3: scores[0] += -0.008998; scores[1] += 0.010264; scores[2] += -0.001118; scores[3] += -0.000148; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.027405; scores[1] += -0.011696; scores[2] += -0.010065; scores[3] += -0.005645; break;
      case 7: scores[0] += -0.000733; scores[1] += -0.002721; scores[2] += 0.030981; scores[3] += -0.027527; break;
    }
  }

  // Tree 341 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003738; scores[1] += 0.003583; scores[2] += -0.001751; scores[3] += 0.001906; break;
      case 1: scores[0] += -0.000017; scores[1] += -0.000100; scores[2] += -0.000596; scores[3] += 0.000714; break;
      case 2: scores[0] += 0.006191; scores[1] += -0.008044; scores[2] += -0.002522; scores[3] += 0.004375; break;
      case 3: scores[0] += -0.000062; scores[1] += -0.000225; scores[2] += 0.014858; scores[3] += -0.014571; break;
      case 4: scores[0] += -0.000060; scores[1] += -0.008455; scores[2] += -0.000184; scores[3] += 0.008700; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000329; scores[1] += -0.000233; scores[2] += 0.020521; scores[3] += -0.019959; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 342 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[34] > 0.550000011920929) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003235; scores[1] += 0.002085; scores[2] += -0.000745; scores[3] += 0.001896; break;
      case 1: scores[0] += 0.005942; scores[1] += -0.000483; scores[2] += -0.000093; scores[3] += -0.005367; break;
      case 2: scores[0] += 0.001280; scores[1] += -0.000024; scores[2] += -0.000017; scores[3] += -0.001239; break;
      case 3: scores[0] += 0.005442; scores[1] += -0.000085; scores[2] += -0.000238; scores[3] += -0.005119; break;
      case 4: scores[0] += -0.000081; scores[1] += -0.000338; scores[2] += 0.013996; scores[3] += -0.013577; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 343 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.366666793823242) << 1) | ((features[32] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.019384; scores[1] += 0.007540; scores[2] += 0.002593; scores[3] += 0.009252; break;
      case 1: scores[0] += -0.000083; scores[1] += -0.000034; scores[2] += 0.013201; scores[3] += -0.013084; break;
      case 2: scores[0] += 0.009863; scores[1] += 0.003314; scores[2] += -0.012440; scores[3] += -0.000737; break;
      case 3: scores[0] += -0.000139; scores[1] += -0.003946; scores[2] += 0.005508; scores[3] += -0.001423; break;
      case 4: scores[0] += -0.000387; scores[1] += -0.013117; scores[2] += 0.027154; scores[3] += -0.013650; break;
      case 5: scores[0] += -0.000049; scores[1] += -0.001356; scores[2] += 0.003188; scores[3] += -0.001783; break;
      case 6: scores[0] += -0.001051; scores[1] += -0.009219; scores[2] += 0.017940; scores[3] += -0.007669; break;
      case 7: scores[0] += -0.000227; scores[1] += -0.002611; scores[2] += 0.006928; scores[3] += -0.004089; break;
    }
  }

  // Tree 344 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002811; scores[1] += -0.011256; scores[2] += 0.007969; scores[3] += 0.000475; break;
      case 1: scores[0] += 0.000297; scores[1] += 0.030594; scores[2] += -0.021995; scores[3] += -0.008896; break;
      case 2: scores[0] += -0.001908; scores[1] += 0.017470; scores[2] += -0.022898; scores[3] += 0.007336; break;
      case 3: scores[0] += -0.000040; scores[1] += 0.022338; scores[2] += -0.000300; scores[3] += -0.021999; break;
      case 4: scores[0] += -0.006225; scores[1] += 0.010526; scores[2] += 0.017086; scores[3] += -0.021387; break;
      case 5: scores[0] += -0.000553; scores[1] += 0.000296; scores[2] += -0.000691; scores[3] += 0.000947; break;
      case 6: scores[0] += -0.001819; scores[1] += -0.002538; scores[2] += -0.009433; scores[3] += 0.013790; break;
      case 7: scores[0] += -0.000008; scores[1] += 0.000981; scores[2] += -0.000069; scores[3] += -0.000904; break;
    }
  }

  // Tree 345 (depth=3)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[9] > 1.5) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.037326; scores[1] += -0.030448; scores[2] += -0.003439; scores[3] += -0.003438; break;
      case 1: scores[0] += 0.023415; scores[1] += -0.000289; scores[2] += -0.000061; scores[3] += -0.023065; break;
      case 2: scores[0] += -0.040378; scores[1] += 0.007765; scores[2] += 0.023541; scores[3] += 0.009072; break;
      case 3: scores[0] += -0.016987; scores[1] += 0.025213; scores[2] += -0.039499; scores[3] += 0.031273; break;
      case 4: scores[0] += -0.001534; scores[1] += -0.001734; scores[2] += -0.000293; scores[3] += 0.003561; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000053; scores[1] += 0.036881; scores[2] += -0.000046; scores[3] += -0.036782; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.000351; scores[2] += -0.000000; scores[3] += -0.000350; break;
    }
  }

  // Tree 346 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[35] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001894; scores[1] += -0.007962; scores[2] += 0.017471; scores[3] += -0.007615; break;
      case 1: scores[0] += -0.001776; scores[1] += 0.013773; scores[2] += -0.002689; scores[3] += -0.009307; break;
      case 2: scores[0] += -0.002273; scores[1] += 0.000991; scores[2] += -0.016748; scores[3] += 0.018030; break;
      case 3: scores[0] += -0.000115; scores[1] += 0.021297; scores[2] += -0.000119; scores[3] += -0.021063; break;
      case 4: scores[0] += 0.004643; scores[1] += 0.012950; scores[2] += -0.041090; scores[3] += 0.023497; break;
      case 5: scores[0] += -0.000362; scores[1] += -0.012263; scores[2] += -0.000306; scores[3] += 0.012932; break;
      case 6: scores[0] += -0.001300; scores[1] += 0.027525; scores[2] += -0.007504; scores[3] += -0.018721; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.001365; scores[2] += -0.000000; scores[3] += -0.001362; break;
    }
  }

  // Tree 347 (depth=3)
  {
    const leafIdx = ((features[43] > 0.20942983031272888) << 0) | ((features[13] > 0.35857143998146057) << 1) | ((features[13] > 0.3291666507720947) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003885; scores[1] += 0.017447; scores[2] += -0.006429; scores[3] += -0.007134; break;
      case 1: scores[0] += -0.000614; scores[1] += -0.012768; scores[2] += -0.000304; scores[3] += 0.013687; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000448; scores[1] += 0.009532; scores[2] += -0.000096; scores[3] += -0.008988; break;
      case 5: scores[0] += -0.000070; scores[1] += -0.030038; scores[2] += -0.000038; scores[3] += 0.030146; break;
      case 6: scores[0] += -0.002050; scores[1] += -0.002645; scores[2] += -0.001652; scores[3] += 0.006347; break;
      case 7: scores[0] += -0.000558; scores[1] += -0.008497; scores[2] += -0.000263; scores[3] += 0.009318; break;
    }
  }

  // Tree 348 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005015; scores[1] += -0.003034; scores[2] += -0.006394; scores[3] += 0.004413; break;
      case 1: scores[0] += -0.000056; scores[1] += -0.000228; scores[2] += 0.014786; scores[3] += -0.014502; break;
      case 2: scores[0] += -0.006724; scores[1] += 0.013261; scores[2] += -0.014094; scores[3] += 0.007557; break;
      case 3: scores[0] += -0.000016; scores[1] += -0.000098; scores[2] += -0.000582; scores[3] += 0.000696; break;
      case 4: scores[0] += -0.001172; scores[1] += -0.000268; scores[2] += 0.041295; scores[3] += -0.039854; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000419; scores[1] += -0.019347; scores[2] += -0.004283; scores[3] += 0.024049; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 349 (depth=3)
  {
    const leafIdx = ((features[13] > 0.7211111187934875) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008116; scores[1] += -0.001112; scores[2] += -0.016452; scores[3] += 0.009448; break;
      case 1: scores[0] += -0.000201; scores[1] += -0.005934; scores[2] += -0.000035; scores[3] += 0.006170; break;
      case 2: scores[0] += -0.000447; scores[1] += 0.017782; scores[2] += -0.000377; scores[3] += -0.016958; break;
      case 3: scores[0] += -0.000238; scores[1] += -0.033328; scores[2] += -0.000121; scores[3] += 0.033688; break;
      case 4: scores[0] += 0.002199; scores[1] += -0.020956; scores[2] += 0.010347; scores[3] += 0.008410; break;
      case 5: scores[0] += -0.000146; scores[1] += -0.000099; scores[2] += -0.000020; scores[3] += 0.000264; break;
      case 6: scores[0] += -0.001784; scores[1] += -0.003839; scores[2] += -0.000784; scores[3] += 0.006407; break;
      case 7: scores[0] += -0.000709; scores[1] += -0.013999; scores[2] += -0.000135; scores[3] += 0.014843; break;
    }
  }

  // Tree 350 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[13] > 0.0889328122138977) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002603; scores[1] += -0.004339; scores[2] += 0.000877; scores[3] += 0.000859; break;
      case 1: scores[0] += -0.000056; scores[1] += -0.000219; scores[2] += 0.014493; scores[3] += -0.014218; break;
      case 2: scores[0] += -0.001060; scores[1] += 0.050559; scores[2] += -0.018477; scores[3] += -0.031022; break;
      case 3: scores[0] += -0.000010; scores[1] += -0.000036; scores[2] += -0.000471; scores[3] += 0.000517; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.006184; scores[1] += 0.001700; scores[2] += -0.005779; scores[3] += 0.010263; break;
      case 7: scores[0] += -0.000006; scores[1] += -0.000060; scores[2] += -0.000114; scores[3] += 0.000180; break;
    }
  }

  // Tree 351 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[40] > 0.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003662; scores[1] += -0.013222; scores[2] += 0.014246; scores[3] += -0.004686; break;
      case 1: scores[0] += -0.000916; scores[1] += -0.000270; scores[2] += 0.012919; scores[3] += -0.011733; break;
      case 2: scores[0] += -0.003540; scores[1] += 0.011315; scores[2] += -0.009133; scores[3] += 0.001358; break;
      case 3: scores[0] += -0.001394; scores[1] += -0.000121; scores[2] += -0.019102; scores[3] += 0.020617; break;
      case 4: scores[0] += -0.005374; scores[1] += 0.004126; scores[2] += -0.010327; scores[3] += 0.011575; break;
      case 5: scores[0] += -0.000168; scores[1] += -0.011449; scores[2] += -0.002677; scores[3] += 0.014294; break;
      case 6: scores[0] += -0.001558; scores[1] += 0.015570; scores[2] += -0.006782; scores[3] += -0.007229; break;
      case 7: scores[0] += -0.000076; scores[1] += -0.014277; scores[2] += -0.001140; scores[3] += 0.015492; break;
    }
  }

  // Tree 352 (depth=3)
  {
    const leafIdx = ((features[43] > 0.23669467866420746) << 0) | ((features[13] > 0.3973684310913086) << 1) | ((features[10] > 9.291666030883789) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.020001; scores[1] += 0.020610; scores[2] += 0.000061; scores[3] += -0.000669; break;
      case 1: scores[0] += -0.000117; scores[1] += -0.026761; scores[2] += -0.000170; scores[3] += 0.027048; break;
      case 2: scores[0] += -0.000481; scores[1] += -0.001788; scores[2] += -0.000828; scores[3] += 0.003097; break;
      case 3: scores[0] += -0.000108; scores[1] += -0.016608; scores[2] += -0.000093; scores[3] += 0.016809; break;
      case 4: scores[0] += 0.015721; scores[1] += -0.002144; scores[2] += -0.006493; scores[3] += -0.007083; break;
      case 5: scores[0] += -0.000411; scores[1] += 0.004397; scores[2] += -0.000088; scores[3] += -0.003897; break;
      case 6: scores[0] += -0.001217; scores[1] += -0.014838; scores[2] += -0.000476; scores[3] += 0.016530; break;
      case 7: scores[0] += -0.000370; scores[1] += 0.003248; scores[2] += -0.000121; scores[3] += -0.002756; break;
    }
  }

  // Tree 353 (depth=3)
  {
    const leafIdx = ((features[43] > 0.1913919448852539) << 0) | ((features[14] > 0.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008281; scores[1] += -0.002199; scores[2] += -0.016025; scores[3] += 0.009944; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000253; scores[1] += 0.029285; scores[2] += -0.000183; scores[3] += -0.028849; break;
      case 3: scores[0] += -0.000492; scores[1] += -0.016485; scores[2] += -0.000320; scores[3] += 0.017297; break;
      case 4: scores[0] += 0.001821; scores[1] += -0.020493; scores[2] += 0.010076; scores[3] += 0.008596; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001570; scores[1] += -0.010307; scores[2] += -0.000586; scores[3] += 0.012463; break;
      case 7: scores[0] += -0.000827; scores[1] += -0.001805; scores[2] += -0.000279; scores[3] += 0.002910; break;
    }
  }

  // Tree 354 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[29] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.025894; scores[1] += 0.005260; scores[2] += -0.020045; scores[3] += -0.011108; break;
      case 1: scores[0] += 0.002296; scores[1] += -0.000067; scores[2] += -0.000189; scores[3] += -0.002040; break;
      case 2: scores[0] += -0.038167; scores[1] += 0.007926; scores[2] += 0.015275; scores[3] += 0.014966; break;
      case 3: scores[0] += -0.001678; scores[1] += 0.023077; scores[2] += -0.002725; scores[3] += -0.018673; break;
      case 4: scores[0] += -0.000073; scores[1] += 0.029192; scores[2] += -0.000013; scores[3] += -0.029107; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000285; scores[1] += -0.009326; scores[2] += -0.000271; scores[3] += 0.009881; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 355 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[16] > 0.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000802; scores[1] += -0.011997; scores[2] += 0.005760; scores[3] += 0.007039; break;
      case 1: scores[0] += 0.004910; scores[1] += 0.016475; scores[2] += -0.023137; scores[3] += 0.001752; break;
      case 2: scores[0] += -0.000001; scores[1] += -0.000255; scores[2] += -0.000003; scores[3] += 0.000260; break;
      case 3: scores[0] += -0.000026; scores[1] += -0.003837; scores[2] += -0.000095; scores[3] += 0.003958; break;
      case 4: scores[0] += -0.001692; scores[1] += 0.016730; scores[2] += -0.000558; scores[3] += -0.014481; break;
      case 5: scores[0] += 0.004673; scores[1] += -0.030344; scores[2] += 0.011741; scores[3] += 0.013931; break;
      case 6: scores[0] += -0.000084; scores[1] += -0.004924; scores[2] += 0.014508; scores[3] += -0.009501; break;
      case 7: scores[0] += -0.000145; scores[1] += -0.000416; scores[2] += 0.000619; scores[3] += -0.000059; break;
    }
  }

  // Tree 356 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.010204081423580647) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004302; scores[1] += -0.001272; scores[2] += -0.006373; scores[3] += 0.003344; break;
      case 1: scores[0] += -0.000051; scores[1] += -0.000217; scores[2] += 0.014028; scores[3] += -0.013760; break;
      case 2: scores[0] += -0.006446; scores[1] += 0.011960; scores[2] += -0.013956; scores[3] += 0.008442; break;
      case 3: scores[0] += -0.000014; scores[1] += -0.000094; scores[2] += -0.000582; scores[3] += 0.000690; break;
      case 4: scores[0] += -0.001078; scores[1] += 0.000408; scores[2] += 0.038960; scores[3] += -0.038290; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000372; scores[1] += -0.018356; scores[2] += -0.004096; scores[3] += 0.022824; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 357 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[25] > 0.5) << 1) | ((features[9] > 1.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.035599; scores[1] += -0.006844; scores[2] += -0.003080; scores[3] += -0.025675; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.004326; scores[1] += -0.005820; scores[2] += -0.000570; scores[3] += 0.010716; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.042144; scores[1] += 0.010896; scores[2] += 0.015000; scores[3] += 0.016247; break;
      case 5: scores[0] += -0.000050; scores[1] += -0.000215; scores[2] += 0.013781; scores[3] += -0.013515; break;
      case 6: scores[0] += -0.002584; scores[1] += 0.012015; scores[2] += -0.016930; scores[3] += 0.007500; break;
      case 7: scores[0] += -0.000014; scores[1] += -0.000094; scores[2] += -0.000581; scores[3] += 0.000689; break;
    }
  }

  // Tree 358 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[19] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001994; scores[1] += -0.004251; scores[2] += 0.006243; scores[3] += 0.000002; break;
      case 1: scores[0] += -0.000022; scores[1] += 0.007679; scores[2] += -0.000087; scores[3] += -0.007570; break;
      case 2: scores[0] += -0.000258; scores[1] += 0.008501; scores[2] += -0.000609; scores[3] += -0.007634; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.001468; scores[1] += -0.011429; scores[2] += 0.010386; scores[3] += -0.000426; break;
      case 5: scores[0] += 0.000289; scores[1] += 0.026210; scores[2] += -0.021966; scores[3] += -0.004533; break;
      case 6: scores[0] += -0.002312; scores[1] += -0.009918; scores[2] += -0.014583; scores[3] += 0.026812; break;
      case 7: scores[0] += -0.000039; scores[1] += 0.022552; scores[2] += -0.000361; scores[3] += -0.022152; break;
    }
  }

  // Tree 359 (depth=3)
  {
    const leafIdx = ((features[43] > 0.17028985917568207) << 0) | ((features[29] > 0.5) << 1) | ((features[9] > 2.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.023511; scores[1] += 0.007368; scores[2] += -0.019447; scores[3] += -0.011432; break;
      case 1: scores[0] += -0.001397; scores[1] += 0.002044; scores[2] += -0.000352; scores[3] += -0.000295; break;
      case 2: scores[0] += -0.000033; scores[1] += 0.022573; scores[2] += -0.000005; scores[3] += -0.022535; break;
      case 3: scores[0] += -0.000034; scores[1] += 0.009610; scores[2] += -0.000006; scores[3] += -0.009570; break;
      case 4: scores[0] += -0.037443; scores[1] += 0.012856; scores[2] += 0.012674; scores[3] += 0.011913; break;
      case 5: scores[0] += -0.000065; scores[1] += -0.012963; scores[2] += -0.000255; scores[3] += 0.013282; break;
      case 6: scores[0] += -0.000267; scores[1] += 0.016385; scores[2] += -0.000202; scores[3] += -0.015916; break;
      case 7: scores[0] += -0.000048; scores[1] += -0.031542; scores[2] += -0.000078; scores[3] += 0.031668; break;
    }
  }

  // Tree 360 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[22] > 0.5) << 1) | ((features[33] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006502; scores[1] += -0.005962; scores[2] += 0.005590; scores[3] += -0.006131; break;
      case 1: scores[0] += 0.000427; scores[1] += 0.018315; scores[2] += -0.002987; scores[3] += -0.015754; break;
      case 2: scores[0] += -0.003787; scores[1] += -0.004208; scores[2] += -0.027392; scores[3] += 0.035386; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.015813; scores[1] += 0.023939; scores[2] += -0.016786; scores[3] += 0.008659; break;
      case 5: scores[0] += -0.000006; scores[1] += 0.006651; scores[2] += -0.000002; scores[3] += -0.006642; break;
      case 6: scores[0] += -0.000004; scores[1] += 0.022673; scores[2] += -0.000001; scores[3] += -0.022668; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 361 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[9] > 5.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004876; scores[1] += 0.005622; scores[2] += -0.003121; scores[3] += 0.002375; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.003455; scores[1] += -0.003953; scores[2] += 0.001399; scores[3] += -0.000900; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000034; scores[1] += -0.018150; scores[2] += -0.000113; scores[3] += 0.018297; break;
      case 5: scores[0] += -0.000014; scores[1] += -0.000094; scores[2] += -0.000569; scores[3] += 0.000677; break;
      case 6: scores[0] += -0.000340; scores[1] += -0.006049; scores[2] += -0.017735; scores[3] += 0.024124; break;
      case 7: scores[0] += -0.000048; scores[1] += -0.000211; scores[2] += 0.013790; scores[3] += -0.013531; break;
    }
  }

  // Tree 362 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004347; scores[1] += 0.004302; scores[2] += -0.002683; scores[3] += 0.002728; break;
      case 1: scores[0] += -0.000014; scores[1] += -0.000093; scores[2] += -0.000569; scores[3] += 0.000676; break;
      case 2: scores[0] += 0.005236; scores[1] += -0.007155; scores[2] += -0.001913; scores[3] += 0.003832; break;
      case 3: scores[0] += -0.000048; scores[1] += -0.000209; scores[2] += 0.013549; scores[3] += -0.013292; break;
      case 4: scores[0] += -0.000046; scores[1] += -0.007819; scores[2] += -0.000163; scores[3] += 0.008027; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000239; scores[1] += -0.000195; scores[2] += 0.017966; scores[3] += -0.017532; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 363 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[33] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003535; scores[1] += -0.008165; scores[2] += 0.014872; scores[3] += -0.003172; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000230; scores[1] += -0.006529; scores[2] += -0.000113; scores[3] += 0.006872; break;
      case 3: scores[0] += 0.006763; scores[1] += -0.004544; scores[2] += -0.001716; scores[3] += -0.000503; break;
      case 4: scores[0] += -0.000024; scores[1] += -0.000157; scores[2] += -0.000034; scores[3] += 0.000215; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000001; scores[1] += -0.023886; scores[2] += -0.000003; scores[3] += 0.023890; break;
      case 7: scores[0] += -0.017335; scores[1] += 0.037603; scores[2] += -0.018260; scores[3] += -0.002008; break;
    }
  }

  // Tree 364 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[8] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004622; scores[1] += 0.001902; scores[2] += 0.001037; scores[3] += 0.001684; break;
      case 1: scores[0] += 0.004218; scores[1] += -0.000424; scores[2] += -0.000071; scores[3] += -0.003723; break;
      case 2: scores[0] += 0.001048; scores[1] += -0.000020; scores[2] += -0.000013; scores[3] += -0.001015; break;
      case 3: scores[0] += 0.002760; scores[1] += -0.000035; scores[2] += -0.000111; scores[3] += -0.002613; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.001305; scores[1] += -0.000022; scores[2] += -0.000014; scores[3] += -0.001269; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.001884; scores[1] += -0.000037; scores[2] += -0.000090; scores[3] += -0.001758; break;
    }
  }

  // Tree 365 (depth=3)
  {
    const leafIdx = ((features[10] > 7.7083330154418945) << 0) | ((features[26] > 0.5) << 1) | ((features[10] > 8.225000381469727) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.026536; scores[1] += 0.006250; scores[2] += 0.015665; scores[3] += 0.004621; break;
      case 1: scores[0] += 0.006249; scores[1] += -0.001069; scores[2] += -0.008505; scores[3] += 0.003325; break;
      case 2: scores[0] += -0.000028; scores[1] += 0.030150; scores[2] += -0.000035; scores[3] += -0.030087; break;
      case 3: scores[0] += -0.000021; scores[1] += -0.001702; scores[2] += -0.000008; scores[3] += 0.001731; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.017372; scores[1] += -0.017186; scores[2] += -0.004085; scores[3] += 0.003899; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.001562; scores[1] += 0.005199; scores[2] += -0.000284; scores[3] += -0.003353; break;
    }
  }

  // Tree 366 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[10] > 5.0833330154418945) << 1) | ((features[39] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000497; scores[1] += -0.005318; scores[2] += -0.000103; scores[3] += 0.005918; break;
      case 1: scores[0] += -0.000262; scores[1] += 0.022025; scores[2] += -0.001862; scores[3] += -0.019900; break;
      case 2: scores[0] += -0.000984; scores[1] += -0.000285; scores[2] += 0.000769; scores[3] += 0.000501; break;
      case 3: scores[0] += 0.000012; scores[1] += 0.028944; scores[2] += -0.021584; scores[3] += -0.007372; break;
      case 4: scores[0] += -0.000071; scores[1] += -0.004739; scores[2] += 0.012920; scores[3] += -0.008111; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000214; scores[1] += -0.009924; scores[2] += 0.006158; scores[3] += 0.003980; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 367 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000333; scores[1] += -0.005592; scores[2] += 0.003933; scores[3] += 0.001326; break;
      case 1: scores[0] += 0.000248; scores[1] += 0.025410; scores[2] += -0.021107; scores[3] += -0.004551; break;
      case 2: scores[0] += -0.001550; scores[1] += 0.005278; scores[2] += -0.000302; scores[3] += -0.003425; break;
      case 3: scores[0] += -0.000009; scores[1] += 0.022375; scores[2] += -0.000006; scores[3] += -0.022360; break;
      case 4: scores[0] += -0.001695; scores[1] += 0.008117; scores[2] += -0.001682; scores[3] += -0.004741; break;
      case 5: scores[0] += -0.000223; scores[1] += 0.002227; scores[2] += -0.001215; scores[3] += -0.000789; break;
      case 6: scores[0] += -0.000046; scores[1] += 0.009511; scores[2] += -0.000016; scores[3] += -0.009450; break;
      case 7: scores[0] += -0.000008; scores[1] += 0.002668; scores[2] += -0.000011; scores[3] += -0.002649; break;
    }
  }

  // Tree 368 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003657; scores[1] += 0.004301; scores[2] += -0.003062; scores[3] += 0.002418; break;
      case 1: scores[0] += -0.000013; scores[1] += -0.000092; scores[2] += -0.000586; scores[3] += 0.000691; break;
      case 2: scores[0] += 0.004766; scores[1] += -0.006757; scores[2] += -0.001555; scores[3] += 0.003546; break;
      case 3: scores[0] += -0.000044; scores[1] += -0.000200; scores[2] += 0.013044; scores[3] += -0.012799; break;
      case 4: scores[0] += -0.000044; scores[1] += -0.007643; scores[2] += -0.000164; scores[3] += 0.007851; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000228; scores[1] += -0.000189; scores[2] += 0.017466; scores[3] += -0.017049; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 369 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[10] > 5.2916669845581055) << 1) | ((features[39] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004718; scores[1] += 0.007434; scores[2] += -0.010250; scores[3] += 0.007534; break;
      case 1: scores[0] += 0.004290; scores[1] += -0.000427; scores[2] += -0.000073; scores[3] += -0.003790; break;
      case 2: scores[0] += -0.002294; scores[1] += 0.001983; scores[2] += -0.000337; scores[3] += 0.000648; break;
      case 3: scores[0] += 0.005536; scores[1] += -0.000088; scores[2] += -0.000205; scores[3] += -0.005243; break;
      case 4: scores[0] += -0.000070; scores[1] += -0.004683; scores[2] += 0.012787; scores[3] += -0.008034; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000213; scores[1] += -0.009773; scores[2] += 0.006131; scores[3] += 0.003855; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 370 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005972; scores[1] += 0.003254; scores[2] += -0.015019; scores[3] += 0.005793; break;
      case 1: scores[0] += -0.000019; scores[1] += 0.015047; scores[2] += -0.000047; scores[3] += -0.014981; break;
      case 2: scores[0] += 0.001505; scores[1] += -0.015679; scores[2] += 0.010560; scores[3] += 0.003615; break;
      case 3: scores[0] += -0.000386; scores[1] += -0.004789; scores[2] += -0.005798; scores[3] += 0.010973; break;
      case 4: scores[0] += -0.001284; scores[1] += 0.006125; scores[2] += -0.001344; scores[3] += -0.003497; break;
      case 5: scores[0] += -0.000003; scores[1] += -0.030491; scores[2] += -0.000004; scores[3] += 0.030499; break;
      case 6: scores[0] += -0.004777; scores[1] += -0.002425; scores[2] += -0.013445; scores[3] += 0.020647; break;
      case 7: scores[0] += -0.000060; scores[1] += -0.004880; scores[2] += -0.001079; scores[3] += 0.006020; break;
    }
  }

  // Tree 371 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[22] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000524; scores[1] += -0.005311; scores[2] += 0.012914; scores[3] += -0.007079; break;
      case 1: scores[0] += 0.000225; scores[1] += 0.029261; scores[2] += -0.021770; scores[3] += -0.007716; break;
      case 2: scores[0] += -0.002432; scores[1] += 0.007957; scores[2] += -0.019016; scores[3] += 0.013491; break;
      case 3: scores[0] += -0.000031; scores[1] += 0.021460; scores[2] += -0.000309; scores[3] += -0.021120; break;
      case 4: scores[0] += -0.003368; scores[1] += -0.002891; scores[2] += -0.025861; scores[3] += 0.032120; break;
      case 5: scores[0] += -0.000493; scores[1] += -0.002116; scores[2] += -0.000367; scores[3] += 0.002975; break;
      case 6: scores[0] += -0.000301; scores[1] += 0.017647; scores[2] += -0.005713; scores[3] += -0.011633; break;
      case 7: scores[0] += -0.000006; scores[1] += 0.000968; scores[2] += -0.000064; scores[3] += -0.000898; break;
    }
  }

  // Tree 372 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005720; scores[1] += 0.003532; scores[2] += -0.014803; scores[3] += 0.005551; break;
      case 1: scores[0] += -0.000018; scores[1] += 0.014738; scores[2] += -0.000046; scores[3] += -0.014675; break;
      case 2: scores[0] += 0.001748; scores[1] += -0.015389; scores[2] += 0.009561; scores[3] += 0.004080; break;
      case 3: scores[0] += -0.000381; scores[1] += -0.004747; scores[2] += -0.004801; scores[3] += 0.009930; break;
      case 4: scores[0] += -0.001288; scores[1] += 0.005910; scores[2] += -0.001363; scores[3] += -0.003259; break;
      case 5: scores[0] += -0.000003; scores[1] += -0.029484; scores[2] += -0.000004; scores[3] += 0.029491; break;
      case 6: scores[0] += -0.004716; scores[1] += -0.002077; scores[2] += -0.013356; scores[3] += 0.020149; break;
      case 7: scores[0] += -0.000059; scores[1] += -0.004811; scores[2] += -0.001039; scores[3] += 0.005909; break;
    }
  }

  // Tree 373 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004493; scores[1] += -0.016360; scores[2] += 0.009942; scores[3] += 0.001924; break;
      case 1: scores[0] += -0.001700; scores[1] += -0.013267; scores[2] += -0.002347; scores[3] += 0.017314; break;
      case 2: scores[0] += -0.003233; scores[1] += 0.056968; scores[2] += -0.034923; scores[3] += -0.018812; break;
      case 3: scores[0] += -0.000091; scores[1] += 0.018180; scores[2] += -0.000098; scores[3] += -0.017991; break;
      case 4: scores[0] += -0.006128; scores[1] += 0.012279; scores[2] += -0.015328; scores[3] += 0.009177; break;
      case 5: scores[0] += -0.000070; scores[1] += 0.020288; scores[2] += -0.000044; scores[3] += -0.020173; break;
      case 6: scores[0] += -0.000166; scores[1] += -0.017304; scores[2] += -0.001493; scores[3] += 0.018963; break;
      case 7: scores[0] += -0.000003; scores[1] += 0.004697; scores[2] += -0.000002; scores[3] += -0.004692; break;
    }
  }

  // Tree 374 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[10] > 13.166666030883789) << 1) | ((features[13] > 0.3973684310913086) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008523; scores[1] += 0.008769; scores[2] += -0.000819; scores[3] += 0.000573; break;
      case 1: scores[0] += -0.000185; scores[1] += 0.008720; scores[2] += -0.000066; scores[3] += -0.008469; break;
      case 2: scores[0] += 0.014416; scores[1] += -0.001764; scores[2] += -0.000389; scores[3] += -0.012262; break;
      case 3: scores[0] += -0.001043; scores[1] += -0.003348; scores[2] += -0.000157; scores[3] += 0.004547; break;
      case 4: scores[0] += -0.001027; scores[1] += -0.010630; scores[2] += -0.001111; scores[3] += 0.012768; break;
      case 5: scores[0] += -0.000033; scores[1] += 0.031996; scores[2] += -0.000019; scores[3] += -0.031944; break;
      case 6: scores[0] += -0.000755; scores[1] += -0.009112; scores[2] += -0.000100; scores[3] += 0.009967; break;
      case 7: scores[0] += -0.000167; scores[1] += -0.009153; scores[2] += -0.000053; scores[3] += 0.009373; break;
    }
  }

  // Tree 375 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.633333206176758) << 1) | ((features[46] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.021980; scores[1] += 0.009079; scores[2] += 0.008165; scores[3] += 0.004736; break;
      case 1: scores[0] += -0.000062; scores[1] += -0.000028; scores[2] += 0.012851; scores[3] += -0.012761; break;
      case 2: scores[0] += 0.012012; scores[1] += -0.001385; scores[2] += -0.011611; scores[3] += 0.000984; break;
      case 3: scores[0] += -0.000231; scores[1] += -0.005718; scores[2] += 0.010003; scores[3] += -0.004055; break;
      case 4: scores[0] += -0.000244; scores[1] += -0.003071; scores[2] += 0.016431; scores[3] += -0.013115; break;
      case 5: scores[0] += -0.000032; scores[1] += -0.001093; scores[2] += 0.002437; scores[3] += -0.001312; break;
      case 6: scores[0] += -0.000570; scores[1] += 0.000702; scores[2] += 0.010254; scores[3] += -0.010386; break;
      case 7: scores[0] += -0.000031; scores[1] += -0.000165; scores[2] += 0.000337; scores[3] += -0.000141; break;
    }
  }

  // Tree 376 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[8] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004027; scores[1] += 0.002035; scores[2] += 0.000528; scores[3] += 0.001464; break;
      case 1: scores[0] += 0.004325; scores[1] += -0.000428; scores[2] += -0.000073; scores[3] += -0.003824; break;
      case 2: scores[0] += 0.001002; scores[1] += -0.000018; scores[2] += -0.000012; scores[3] += -0.000971; break;
      case 3: scores[0] += 0.002649; scores[1] += -0.000033; scores[2] += -0.000109; scores[3] += -0.002506; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.001273; scores[1] += -0.000020; scores[2] += -0.000013; scores[3] += -0.001239; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.001775; scores[1] += -0.000033; scores[2] += -0.000086; scores[3] += -0.001656; break;
    }
  }

  // Tree 377 (depth=3)
  {
    const leafIdx = ((features[46] > 0.5) << 0) | ((features[10] > 8.366666793823242) << 1) | ((features[38] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.014674; scores[1] += 0.009674; scores[2] += 0.000687; scores[3] += 0.004313; break;
      case 1: scores[0] += -0.000264; scores[1] += -0.004662; scores[2] += 0.008555; scores[3] += -0.003630; break;
      case 2: scores[0] += 0.015346; scores[1] += -0.004190; scores[2] += -0.018762; scores[3] += 0.007606; break;
      case 3: scores[0] += -0.000113; scores[1] += -0.000863; scores[2] += 0.006820; scores[3] += -0.005844; break;
      case 4: scores[0] += -0.010764; scores[1] += -0.002782; scores[2] += 0.004140; scores[3] += 0.009406; break;
      case 5: scores[0] += -0.000393; scores[1] += 0.001987; scores[2] += 0.014375; scores[3] += -0.015970; break;
      case 6: scores[0] += 0.009898; scores[1] += -0.006226; scores[2] += -0.001193; scores[3] += -0.002479; break;
      case 7: scores[0] += -0.000091; scores[1] += 0.000811; scores[2] += -0.000467; scores[3] += -0.000253; break;
    }
  }

  // Tree 378 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[43] > 0.40312498807907104) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001210; scores[1] += 0.001870; scores[2] += -0.001794; scores[3] += -0.001286; break;
      case 1: scores[0] += -0.000203; scores[1] += 0.012187; scores[2] += -0.000066; scores[3] += -0.011917; break;
      case 2: scores[0] += 0.004057; scores[1] += -0.028200; scores[2] += 0.011124; scores[3] += 0.013020; break;
      case 3: scores[0] += -0.000927; scores[1] += -0.014293; scores[2] += -0.000133; scores[3] += 0.015353; break;
      case 4: scores[0] += -0.000160; scores[1] += -0.024225; scores[2] += -0.000087; scores[3] += 0.024472; break;
      case 5: scores[0] += -0.000076; scores[1] += 0.017361; scores[2] += -0.000034; scores[3] += -0.017251; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.000116; scores[1] += -0.004630; scores[2] += -0.000034; scores[3] += 0.004781; break;
    }
  }

  // Tree 379 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[10] > 7.7083330154418945) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.027280; scores[1] += 0.006496; scores[2] += 0.015813; scores[3] += 0.004972; break;
      case 1: scores[0] += 0.004344; scores[1] += -0.000435; scores[2] += -0.000073; scores[3] += -0.003836; break;
      case 2: scores[0] += 0.015946; scores[1] += -0.012325; scores[2] += -0.006754; scores[3] += 0.003133; break;
      case 3: scores[0] += 0.005301; scores[1] += -0.000082; scores[2] += -0.000195; scores[3] += -0.005023; break;
      case 4: scores[0] += -0.000025; scores[1] += 0.027874; scores[2] += -0.000032; scores[3] += -0.027818; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001451; scores[1] += 0.002148; scores[2] += -0.000255; scores[3] += -0.000442; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 380 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.633333206176758) << 1) | ((features[46] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.020213; scores[1] += 0.007843; scores[2] += 0.007690; scores[3] += 0.004679; break;
      case 1: scores[0] += -0.000059; scores[1] += -0.000029; scores[2] += 0.012761; scores[3] += -0.012673; break;
      case 2: scores[0] += 0.010957; scores[1] += -0.001437; scores[2] += -0.010064; scores[3] += 0.000543; break;
      case 3: scores[0] += -0.000231; scores[1] += -0.005630; scores[2] += 0.009992; scores[3] += -0.004132; break;
      case 4: scores[0] += -0.000233; scores[1] += -0.002957; scores[2] += 0.015757; scores[3] += -0.012568; break;
      case 5: scores[0] += -0.000030; scores[1] += -0.001079; scores[2] += 0.002389; scores[3] += -0.001280; break;
      case 6: scores[0] += -0.000562; scores[1] += 0.000735; scores[2] += 0.009838; scores[3] += -0.010011; break;
      case 7: scores[0] += -0.000030; scores[1] += -0.000164; scores[2] += 0.000327; scores[3] += -0.000132; break;
    }
  }

  // Tree 381 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[13] > 0.024695120751857758) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004147; scores[1] += -0.016545; scores[2] += 0.010963; scores[3] += 0.001436; break;
      case 1: scores[0] += -0.001657; scores[1] += -0.012969; scores[2] += -0.002313; scores[3] += 0.016939; break;
      case 2: scores[0] += -0.003112; scores[1] += 0.054662; scores[2] += -0.033590; scores[3] += -0.017959; break;
      case 3: scores[0] += -0.000088; scores[1] += 0.017817; scores[2] += -0.000096; scores[3] += -0.017633; break;
      case 4: scores[0] += -0.006095; scores[1] += 0.011956; scores[2] += -0.014769; scores[3] += 0.008908; break;
      case 5: scores[0] += -0.000070; scores[1] += 0.019610; scores[2] += -0.000042; scores[3] += -0.019498; break;
      case 6: scores[0] += -0.000120; scores[1] += -0.016883; scores[2] += -0.001213; scores[3] += 0.018216; break;
      case 7: scores[0] += -0.000003; scores[1] += 0.004663; scores[2] += -0.000002; scores[3] += -0.004657; break;
    }
  }

  // Tree 382 (depth=3)
  {
    const leafIdx = ((features[43] > 0.23669467866420746) << 0) | ((features[13] > 0.35388994216918945) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001336; scores[1] += 0.023182; scores[2] += -0.017030; scores[3] += -0.007488; break;
      case 1: scores[0] += -0.000113; scores[1] += -0.024999; scores[2] += -0.000091; scores[3] += 0.025203; break;
      case 2: scores[0] += -0.000571; scores[1] += -0.004198; scores[2] += -0.000796; scores[3] += 0.005564; break;
      case 3: scores[0] += -0.000300; scores[1] += -0.009454; scores[2] += -0.000149; scores[3] += 0.009903; break;
      case 4: scores[0] += 0.000181; scores[1] += -0.017202; scores[2] += 0.009410; scores[3] += 0.007611; break;
      case 5: scores[0] += -0.000298; scores[1] += -0.001022; scores[2] += -0.000112; scores[3] += 0.001432; break;
      case 6: scores[0] += -0.001146; scores[1] += -0.011788; scores[2] += -0.000494; scores[3] += 0.013428; break;
      case 7: scores[0] += -0.000181; scores[1] += 0.005065; scores[2] += -0.000057; scores[3] += -0.004827; break;
    }
  }

  // Tree 383 (depth=3)
  {
    const leafIdx = ((features[40] > 0.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.6885775923728943) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000956; scores[1] += 0.005368; scores[2] += -0.014776; scores[3] += 0.008451; break;
      case 1: scores[0] += 0.006718; scores[1] += 0.013987; scores[2] += -0.001641; scores[3] += -0.019064; break;
      case 2: scores[0] += 0.002814; scores[1] += -0.009786; scores[2] += 0.015974; scores[3] += -0.009001; break;
      case 3: scores[0] += -0.005775; scores[1] += -0.011204; scores[2] += -0.006547; scores[3] += 0.023526; break;
      case 4: scores[0] += -0.000366; scores[1] += -0.024364; scores[2] += -0.000125; scores[3] += 0.024855; break;
      case 5: scores[0] += -0.000012; scores[1] += -0.020994; scores[2] += -0.000007; scores[3] += 0.021014; break;
      case 6: scores[0] += -0.000566; scores[1] += -0.008376; scores[2] += -0.000083; scores[3] += 0.009026; break;
      case 7: scores[0] += -0.000232; scores[1] += -0.006302; scores[2] += -0.000037; scores[3] += 0.006572; break;
    }
  }

  // Tree 384 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.010204081423580647) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002529; scores[1] += -0.002349; scores[2] += -0.001447; scores[3] += 0.001267; break;
      case 1: scores[0] += -0.000040; scores[1] += -0.000221; scores[2] += 0.013525; scores[3] += -0.013264; break;
      case 2: scores[0] += -0.006081; scores[1] += 0.011268; scores[2] += -0.015113; scores[3] += 0.009926; break;
      case 3: scores[0] += -0.000011; scores[1] += -0.000082; scores[2] += -0.000553; scores[3] += 0.000646; break;
      case 4: scores[0] += -0.000201; scores[1] += -0.000153; scores[2] += 0.016400; scores[3] += -0.016046; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000039; scores[1] += -0.007536; scores[2] += -0.000148; scores[3] += 0.007723; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 385 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002280; scores[1] += 0.003086; scores[2] += -0.003113; scores[3] += 0.002307; break;
      case 1: scores[0] += -0.000011; scores[1] += -0.000082; scores[2] += -0.000552; scores[3] += 0.000645; break;
      case 2: scores[0] += 0.003661; scores[1] += -0.004825; scores[2] += -0.001602; scores[3] += 0.002767; break;
      case 3: scores[0] += -0.000040; scores[1] += -0.000219; scores[2] += 0.013292; scores[3] += -0.013033; break;
      case 4: scores[0] += -0.000039; scores[1] += -0.007442; scores[2] += -0.000147; scores[3] += 0.007628; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000199; scores[1] += -0.000152; scores[2] += 0.016063; scores[3] += -0.015712; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 386 (depth=3)
  {
    const leafIdx = ((features[47] > 0.8166666626930237) << 0) | ((features[13] > 0.6030303239822388) << 1) | ((features[47] > 0.7166666984558105) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002029; scores[1] += 0.006081; scores[2] += -0.001720; scores[3] += -0.002332; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000964; scores[1] += -0.025961; scores[2] += -0.000256; scores[3] += 0.027181; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.001261; scores[1] += -0.011173; scores[2] += -0.000038; scores[3] += 0.009950; break;
      case 5: scores[0] += -0.000004; scores[1] += -0.004921; scores[2] += -0.000002; scores[3] += 0.004926; break;
      case 6: scores[0] += -0.000039; scores[1] += -0.000758; scores[2] += -0.000006; scores[3] += 0.000803; break;
      case 7: scores[0] += -0.000003; scores[1] += -0.000139; scores[2] += -0.000001; scores[3] += 0.000143; break;
    }
  }

  // Tree 387 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.3090185523033142) << 1) | ((features[13] > 0.3771551847457886) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001602; scores[1] += 0.008947; scores[2] += -0.004139; scores[3] += -0.003206; break;
      case 1: scores[0] += -0.000047; scores[1] += -0.000253; scores[2] += 0.012617; scores[3] += -0.012317; break;
      case 2: scores[0] += -0.000788; scores[1] += -0.013191; scores[2] += -0.000154; scores[3] += 0.014133; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001975; scores[1] += -0.003471; scores[2] += -0.001278; scores[3] += 0.006725; break;
      case 7: scores[0] += -0.000004; scores[1] += -0.000053; scores[2] += -0.000110; scores[3] += 0.000167; break;
    }
  }

  // Tree 388 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[10] > 4.775000095367432) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005344; scores[1] += -0.009611; scores[2] += 0.008439; scores[3] += -0.004173; break;
      case 1: scores[0] += -0.000181; scores[1] += 0.004717; scores[2] += -0.001370; scores[3] += -0.003166; break;
      case 2: scores[0] += -0.000008; scores[1] += 0.006581; scores[2] += -0.000061; scores[3] += -0.006512; break;
      case 3: scores[0] += -0.000005; scores[1] += 0.006377; scores[2] += -0.000056; scores[3] += -0.006316; break;
      case 4: scores[0] += -0.002387; scores[1] += -0.005426; scores[2] += 0.008586; scores[3] += -0.000774; break;
      case 5: scores[0] += 0.000462; scores[1] += 0.025146; scores[2] += -0.020994; scores[3] += -0.004615; break;
      case 6: scores[0] += -0.002554; scores[1] += 0.010721; scores[2] += -0.019939; scores[3] += 0.011772; break;
      case 7: scores[0] += -0.000027; scores[1] += 0.016445; scores[2] += -0.000296; scores[3] += -0.016123; break;
    }
  }

  // Tree 389 (depth=3)
  {
    const leafIdx = ((features[43] > 0.1913919448852539) << 0) | ((features[30] > 0.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.008007; scores[1] += -0.004422; scores[2] += -0.013290; scores[3] += 0.009705; break;
      case 1: scores[0] += -0.000241; scores[1] += 0.004771; scores[2] += -0.000174; scores[3] += -0.004356; break;
      case 2: scores[0] += -0.000225; scores[1] += 0.037431; scores[2] += -0.000052; scores[3] += -0.037154; break;
      case 3: scores[0] += -0.000121; scores[1] += -0.041485; scores[2] += -0.000068; scores[3] += 0.041674; break;
      case 4: scores[0] += -0.009932; scores[1] += -0.013998; scores[2] += 0.015864; scores[3] += 0.008067; break;
      case 5: scores[0] += -0.000324; scores[1] += 0.013912; scores[2] += -0.000149; scores[3] += -0.013439; break;
      case 6: scores[0] += 0.012595; scores[1] += -0.006205; scores[2] += -0.026323; scores[3] += 0.019934; break;
      case 7: scores[0] += -0.000396; scores[1] += -0.015396; scores[2] += -0.000082; scores[3] += 0.015874; break;
    }
  }

  // Tree 390 (depth=3)
  {
    const leafIdx = ((features[13] > 0.20344828069210052) << 0) | ((features[9] > 3.5) << 1) | ((features[11] > 0.011627906933426857) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.010725; scores[1] += -0.002376; scores[2] += -0.018448; scores[3] += 0.010100; break;
      case 1: scores[0] += -0.000924; scores[1] += 0.006874; scores[2] += -0.000738; scores[3] += -0.005211; break;
      case 2: scores[0] += -0.004228; scores[1] += 0.024256; scores[2] += 0.005061; scores[3] += -0.025089; break;
      case 3: scores[0] += -0.000118; scores[1] += -0.025731; scores[2] += -0.000288; scores[3] += 0.026137; break;
      case 4: scores[0] += 0.004465; scores[1] += -0.015104; scores[2] += 0.011062; scores[3] += -0.000423; break;
      case 5: scores[0] += -0.002808; scores[1] += -0.004641; scores[2] += -0.000643; scores[3] += 0.008092; break;
      case 6: scores[0] += -0.010214; scores[1] += -0.004847; scores[2] += 0.003994; scores[3] += 0.011067; break;
      case 7: scores[0] += -0.000116; scores[1] += -0.004691; scores[2] += -0.000274; scores[3] += 0.005080; break;
    }
  }

  // Tree 391 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[34] > 0.05000000074505806) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007583; scores[1] += -0.017220; scores[2] += -0.002372; scores[3] += 0.012009; break;
      case 1: scores[0] += 0.000710; scores[1] += 0.013152; scores[2] += -0.000669; scores[3] += -0.013193; break;
      case 2: scores[0] += -0.002721; scores[1] += 0.013372; scores[2] += -0.004300; scores[3] += -0.006351; break;
      case 3: scores[0] += -0.000006; scores[1] += 0.006503; scores[2] += -0.000004; scores[3] += -0.006493; break;
      case 4: scores[0] += -0.000702; scores[1] += 0.030985; scores[2] += 0.011932; scores[3] += -0.042215; break;
      case 5: scores[0] += -0.000629; scores[1] += 0.006852; scores[2] += -0.002499; scores[3] += -0.003724; break;
      case 6: scores[0] += -0.003302; scores[1] += -0.034463; scores[2] += 0.009401; scores[3] += 0.028365; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 392 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[10] > 5.633333206176758) << 1) | ((features[40] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000555; scores[1] += -0.011545; scores[2] += 0.015488; scores[3] += -0.003388; break;
      case 1: scores[0] += -0.000497; scores[1] += 0.017491; scores[2] += -0.002839; scores[3] += -0.014155; break;
      case 2: scores[0] += 0.000845; scores[1] += -0.015034; scores[2] += 0.016534; scores[3] += -0.002346; break;
      case 3: scores[0] += 0.001313; scores[1] += 0.022140; scores[2] += -0.019619; scores[3] += -0.003834; break;
      case 4: scores[0] += -0.000232; scores[1] += -0.005602; scores[2] += -0.000404; scores[3] += 0.006238; break;
      case 5: scores[0] += -0.000002; scores[1] += 0.013608; scores[2] += -0.000002; scores[3] += -0.013604; break;
      case 6: scores[0] += -0.002708; scores[1] += 0.020363; scores[2] += -0.020332; scores[3] += 0.002677; break;
      case 7: scores[0] += -0.000338; scores[1] += -0.001034; scores[2] += -0.000507; scores[3] += 0.001879; break;
    }
  }

  // Tree 393 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000046; scores[1] += -0.006982; scores[2] += 0.008403; scores[3] += -0.001468; break;
      case 1: scores[0] += 0.000474; scores[1] += 0.026059; scores[2] += -0.020838; scores[3] += -0.005695; break;
      case 2: scores[0] += -0.002320; scores[1] += 0.008089; scores[2] += -0.018370; scores[3] += 0.012602; break;
      case 3: scores[0] += -0.000030; scores[1] += 0.019501; scores[2] += -0.000354; scores[3] += -0.019116; break;
      case 4: scores[0] += -0.001599; scores[1] += 0.001488; scores[2] += -0.001408; scores[3] += 0.001519; break;
      case 5: scores[0] += -0.000190; scores[1] += 0.001647; scores[2] += -0.001144; scores[3] += -0.000313; break;
      case 6: scores[0] += -0.000088; scores[1] += 0.018306; scores[2] += -0.000089; scores[3] += -0.018128; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.002799; scores[2] += -0.000001; scores[3] += -0.002797; break;
    }
  }

  // Tree 394 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[13] > 0.029857397079467773) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004100; scores[1] += -0.019763; scores[2] += 0.013200; scores[3] += 0.002463; break;
      case 1: scores[0] += 0.002847; scores[1] += -0.004863; scores[2] += -0.016946; scores[3] += 0.018962; break;
      case 2: scores[0] += -0.003061; scores[1] += 0.054174; scores[2] += -0.032198; scores[3] += -0.018916; break;
      case 3: scores[0] += -0.000027; scores[1] += 0.008145; scores[2] += -0.000332; scores[3] += -0.007786; break;
      case 4: scores[0] += -0.005756; scores[1] += 0.011421; scores[2] += -0.014451; scores[3] += 0.008786; break;
      case 5: scores[0] += -0.000057; scores[1] += 0.028678; scores[2] += -0.000045; scores[3] += -0.028576; break;
      case 6: scores[0] += -0.000054; scores[1] += -0.020496; scores[2] += -0.000297; scores[3] += 0.020848; break;
      case 7: scores[0] += -0.000003; scores[1] += 0.014146; scores[2] += -0.000009; scores[3] += -0.014134; break;
    }
  }

  // Tree 395 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000064; scores[1] += -0.005815; scores[2] += 0.006910; scores[3] += -0.001159; break;
      case 1: scores[0] += 0.000659; scores[1] += 0.024115; scores[2] += -0.019910; scores[3] += -0.004864; break;
      case 2: scores[0] += -0.002352; scores[1] += 0.008200; scores[2] += -0.017200; scores[3] += 0.011351; break;
      case 3: scores[0] += -0.000031; scores[1] += 0.019220; scores[2] += -0.000358; scores[3] += -0.018831; break;
      case 4: scores[0] += -0.001609; scores[1] += 0.001895; scores[2] += -0.001429; scores[3] += 0.001143; break;
      case 5: scores[0] += -0.000187; scores[1] += 0.001533; scores[2] += -0.001103; scores[3] += -0.000242; break;
      case 6: scores[0] += -0.000087; scores[1] += 0.017433; scores[2] += -0.000085; scores[3] += -0.017261; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.002738; scores[2] += -0.000001; scores[3] += -0.002737; break;
    }
  }

  // Tree 396 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[34] > 0.550000011920929) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003019; scores[1] += -0.005948; scores[2] += 0.000915; scores[3] += 0.002014; break;
      case 1: scores[0] += 0.000146; scores[1] += 0.017081; scores[2] += -0.003027; scores[3] += -0.014200; break;
      case 2: scores[0] += -0.000039; scores[1] += -0.000226; scores[2] += 0.013816; scores[3] += -0.013551; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.005765; scores[1] += 0.011209; scores[2] += -0.014876; scores[3] += 0.009432; break;
      case 5: scores[0] += -0.000035; scores[1] += 0.007765; scores[2] += -0.000010; scores[3] += -0.007720; break;
      case 6: scores[0] += -0.000010; scores[1] += -0.000074; scores[2] += -0.000508; scores[3] += 0.000592; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 397 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[13] > 0.08012820780277252) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002186; scores[1] += -0.002529; scores[2] += -0.000449; scores[3] += 0.000792; break;
      case 1: scores[0] += -0.000039; scores[1] += -0.000224; scores[2] += 0.013575; scores[3] += -0.013312; break;
      case 2: scores[0] += -0.000782; scores[1] += 0.046776; scores[2] += -0.015618; scores[3] += -0.030376; break;
      case 3: scores[0] += -0.000006; scores[1] += -0.000029; scores[2] += -0.000411; scores[3] += 0.000446; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.005265; scores[1] += 0.001156; scores[2] += -0.004748; scores[3] += 0.008856; break;
      case 7: scores[0] += -0.000004; scores[1] += -0.000046; scores[2] += -0.000098; scores[3] += 0.000148; break;
    }
  }

  // Tree 398 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[43] > 0.20942983031272888) << 1) | ((features[9] > 2.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.020429; scores[1] += 0.013323; scores[2] += -0.018943; scores[3] += -0.014809; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.001004; scores[1] += 0.005257; scores[2] += -0.000261; scores[3] += -0.003992; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.035892; scores[1] += 0.016421; scores[2] += 0.008664; scores[3] += 0.010807; break;
      case 5: scores[0] += -0.000050; scores[1] += -0.000306; scores[2] += 0.012838; scores[3] += -0.012482; break;
      case 6: scores[0] += -0.000058; scores[1] += -0.029382; scores[2] += -0.000178; scores[3] += 0.029619; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 399 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001726; scores[1] += -0.009202; scores[2] += 0.006072; scores[3] += 0.001404; break;
      case 1: scores[0] += 0.000591; scores[1] += 0.024844; scores[2] += -0.020107; scores[3] += -0.005327; break;
      case 2: scores[0] += -0.001297; scores[1] += 0.014546; scores[2] += -0.018401; scores[3] += 0.005152; break;
      case 3: scores[0] += -0.000027; scores[1] += 0.020541; scores[2] += -0.000321; scores[3] += -0.020193; break;
      case 4: scores[0] += -0.004299; scores[1] += 0.013830; scores[2] += 0.010144; scores[3] += -0.019675; break;
      case 5: scores[0] += -0.000384; scores[1] += -0.000099; scores[2] += -0.000560; scores[3] += 0.001043; break;
      case 6: scores[0] += -0.001102; scores[1] += -0.004410; scores[2] += -0.005743; scores[3] += 0.011255; break;
      case 7: scores[0] += -0.000004; scores[1] += 0.000724; scores[2] += -0.000053; scores[3] += -0.000667; break;
    }
  }

  // Tree 400 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[11] > 0.06857366859912872) << 1) | ((features[13] > 0.024099882692098618) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001043; scores[1] += 0.002373; scores[2] += -0.006356; scores[3] += 0.005026; break;
      case 1: scores[0] += -0.003588; scores[1] += -0.006743; scores[2] += 0.000849; scores[3] += 0.009481; break;
      case 2: scores[0] += 0.013394; scores[1] += 0.000188; scores[2] += -0.021875; scores[3] += 0.008293; break;
      case 3: scores[0] += -0.002388; scores[1] += -0.000371; scores[2] += 0.016165; scores[3] += -0.013406; break;
      case 4: scores[0] += -0.001736; scores[1] += 0.001319; scores[2] += -0.000721; scores[3] += 0.001137; break;
      case 5: scores[0] += -0.000157; scores[1] += 0.011146; scores[2] += -0.001687; scores[3] += -0.009302; break;
      case 6: scores[0] += -0.003977; scores[1] += 0.003156; scores[2] += -0.001381; scores[3] += 0.002202; break;
      case 7: scores[0] += -0.000552; scores[1] += 0.008419; scores[2] += -0.013243; scores[3] += 0.005375; break;
    }
  }

  // Tree 401 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[10] > 4.9166669845581055) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005216; scores[1] += -0.005236; scores[2] += 0.004251; scores[3] += -0.004231; break;
      case 1: scores[0] += -0.000001; scores[1] += -0.018564; scores[2] += -0.000001; scores[3] += 0.018566; break;
      case 2: scores[0] += -0.000213; scores[1] += 0.001019; scores[2] += -0.002118; scores[3] += 0.001312; break;
      case 3: scores[0] += -0.000068; scores[1] += -0.007857; scores[2] += -0.000657; scores[3] += 0.008582; break;
      case 4: scores[0] += -0.000116; scores[1] += 0.010860; scores[2] += 0.003454; scores[3] += -0.014197; break;
      case 5: scores[0] += -0.000005; scores[1] += -0.000370; scores[2] += -0.000037; scores[3] += 0.000412; break;
      case 6: scores[0] += -0.005289; scores[1] += 0.011876; scores[2] += 0.003408; scores[3] += -0.009994; break;
      case 7: scores[0] += -0.000287; scores[1] += -0.004257; scores[2] += -0.003237; scores[3] += 0.007781; break;
    }
  }

  // Tree 402 (depth=3)
  {
    const leafIdx = ((features[43] > 0.2886904776096344) << 0) | ((features[13] > 0.34428879618644714) << 1) | ((features[13] > 0.3291666507720947) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002618; scores[1] += 0.011320; scores[2] += -0.004574; scores[3] += -0.004128; break;
      case 1: scores[0] += -0.000072; scores[1] += -0.011535; scores[2] += -0.000025; scores[3] += 0.011632; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000312; scores[1] += 0.004661; scores[2] += -0.000035; scores[3] += -0.004314; break;
      case 5: scores[0] += -0.000045; scores[1] += -0.023848; scores[2] += -0.000018; scores[3] += 0.023911; break;
      case 6: scores[0] += -0.001628; scores[1] += -0.003774; scores[2] += -0.001199; scores[3] += 0.006601; break;
      case 7: scores[0] += -0.000431; scores[1] += -0.004170; scores[2] += -0.000186; scores[3] += 0.004787; break;
    }
  }

  // Tree 403 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[13] > 0.47913044691085815) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001186; scores[1] += -0.007155; scores[2] += 0.003604; scores[3] += 0.002365; break;
      case 1: scores[0] += 0.001268; scores[1] += 0.011238; scores[2] += -0.018440; scores[3] += 0.005934; break;
      case 2: scores[0] += -0.001756; scores[1] += 0.006855; scores[2] += -0.000722; scores[3] += -0.004377; break;
      case 3: scores[0] += -0.000020; scores[1] += 0.030476; scores[2] += -0.000030; scores[3] += -0.030427; break;
      case 4: scores[0] += -0.000327; scores[1] += -0.026975; scores[2] += -0.000310; scores[3] += 0.027612; break;
      case 5: scores[0] += -0.000007; scores[1] += -0.000947; scores[2] += -0.000001; scores[3] += 0.000955; break;
      case 6: scores[0] += -0.001084; scores[1] += 0.002111; scores[2] += -0.000350; scores[3] += -0.000678; break;
      case 7: scores[0] += -0.000007; scores[1] += 0.001894; scores[2] += -0.000005; scores[3] += -0.001883; break;
    }
  }

  // Tree 404 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.366666793823242) << 1) | ((features[46] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.018944; scores[1] += 0.004038; scores[2] += 0.008834; scores[3] += 0.006073; break;
      case 1: scores[0] += -0.000055; scores[1] += -0.000024; scores[2] += 0.012462; scores[3] += -0.012383; break;
      case 2: scores[0] += 0.009306; scores[1] += 0.002941; scores[2] += -0.011714; scores[3] += -0.000533; break;
      case 3: scores[0] += -0.000202; scores[1] += -0.005141; scores[2] += 0.009240; scores[3] += -0.003897; break;
      case 4: scores[0] += -0.000163; scores[1] += -0.002395; scores[2] += 0.010714; scores[3] += -0.008156; break;
      case 5: scores[0] += -0.000026; scores[1] += -0.000969; scores[2] += 0.002045; scores[3] += -0.001049; break;
      case 6: scores[0] += -0.000556; scores[1] += 0.000752; scores[2] += 0.012414; scores[3] += -0.012610; break;
      case 7: scores[0] += -0.000027; scores[1] += -0.000167; scores[2] += 0.000278; scores[3] += -0.000084; break;
    }
  }

  // Tree 405 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.027402402833104134) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002970; scores[1] += -0.001942; scores[2] += -0.004102; scores[3] += 0.003074; break;
      case 1: scores[0] += -0.000037; scores[1] += -0.000217; scores[2] += 0.013076; scores[3] += -0.012822; break;
      case 2: scores[0] += -0.005534; scores[1] += 0.012290; scores[2] += -0.014445; scores[3] += 0.007689; break;
      case 3: scores[0] += -0.000010; scores[1] += -0.000073; scores[2] += -0.000500; scores[3] += 0.000583; break;
      case 4: scores[0] += -0.000279; scores[1] += -0.001402; scores[2] += 0.030920; scores[3] += -0.029239; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000245; scores[1] += -0.017657; scores[2] += -0.000085; scores[3] += 0.017987; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 406 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[34] > 0.3500000238418579) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002534; scores[1] += -0.005947; scores[2] += 0.014292; scores[3] += -0.005810; break;
      case 1: scores[0] += -0.001696; scores[1] += 0.002669; scores[2] += -0.002356; scores[3] += 0.001383; break;
      case 2: scores[0] += -0.001950; scores[1] += 0.020500; scores[2] += -0.033859; scores[3] += 0.015308; break;
      case 3: scores[0] += -0.000083; scores[1] += 0.018766; scores[2] += -0.000081; scores[3] += -0.018602; break;
      case 4: scores[0] += -0.001520; scores[1] += -0.015376; scores[2] += -0.004270; scores[3] += 0.021166; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000194; scores[1] += -0.009620; scores[2] += 0.018717; scores[3] += -0.008903; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 407 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[10] > 5.366666793823242) << 1) | ((features[39] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000798; scores[1] += -0.000766; scores[2] += 0.003944; scores[3] += -0.002381; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000839; scores[1] += -0.015600; scores[2] += 0.006132; scores[3] += 0.010307; break;
      case 3: scores[0] += -0.001188; scores[1] += 0.006294; scores[2] += -0.004540; scores[3] += -0.000566; break;
      case 4: scores[0] += -0.000080; scores[1] += -0.005183; scores[2] += 0.014189; scores[3] += -0.008926; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000006; scores[1] += -0.001061; scores[2] += -0.000031; scores[3] += 0.001099; break;
      case 7: scores[0] += -0.000140; scores[1] += -0.006525; scores[2] += 0.000923; scores[3] += 0.005742; break;
    }
  }

  // Tree 408 (depth=3)
  {
    const leafIdx = ((features[13] > 0.7211111187934875) << 0) | ((features[10] > 3.5833334922790527) << 1) | ((features[47] > 0.7166666984558105) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000002; scores[1] += 0.009089; scores[2] += -0.000004; scores[3] += -0.009083; break;
      case 1: scores[0] += -0.000004; scores[1] += -0.002336; scores[2] += -0.000005; scores[3] += 0.002345; break;
      case 2: scores[0] += -0.002442; scores[1] += 0.005928; scores[2] += -0.001620; scores[3] += -0.001866; break;
      case 3: scores[0] += -0.000775; scores[1] += -0.032214; scores[2] += -0.000163; scores[3] += 0.033152; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.001246; scores[1] += -0.013863; scores[2] += -0.000039; scores[3] += 0.012656; break;
      case 7: scores[0] += -0.000039; scores[1] += -0.000821; scores[2] += -0.000006; scores[3] += 0.000866; break;
    }
  }

  // Tree 409 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[40] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001518; scores[1] += -0.017648; scores[2] += 0.025410; scores[3] += -0.006245; break;
      case 1: scores[0] += 0.001199; scores[1] += 0.015173; scores[2] += -0.018108; scores[3] += 0.001736; break;
      case 2: scores[0] += -0.001832; scores[1] += 0.003873; scores[2] += -0.013879; scores[3] += 0.011838; break;
      case 3: scores[0] += -0.000030; scores[1] += 0.020496; scores[2] += -0.000331; scores[3] += -0.020135; break;
      case 4: scores[0] += -0.002226; scores[1] += 0.016501; scores[2] += -0.017990; scores[3] += 0.003715; break;
      case 5: scores[0] += -0.000482; scores[1] += 0.011602; scores[2] += -0.000495; scores[3] += -0.010625; break;
      case 6: scores[0] += -0.000533; scores[1] += 0.002524; scores[2] += -0.004291; scores[3] += 0.002300; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 410 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[43] > 0.28285714983940125) << 1) | ((features[10] > 4.7083330154418945) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005327; scores[1] += 0.003358; scores[2] += 0.003466; scores[3] += -0.012150; break;
      case 1: scores[0] += -0.000162; scores[1] += -0.002150; scores[2] += -0.001189; scores[3] += 0.003501; break;
      case 2: scores[0] += -0.000030; scores[1] += -0.004197; scores[2] += -0.000046; scores[3] += 0.004273; break;
      case 3: scores[0] += -0.000001; scores[1] += 0.011586; scores[2] += -0.000007; scores[3] += -0.011578; break;
      case 4: scores[0] += -0.003094; scores[1] += 0.000331; scores[2] += 0.002241; scores[3] += 0.000521; break;
      case 5: scores[0] += -0.000038; scores[1] += 0.027883; scores[2] += -0.019176; scores[3] += -0.008669; break;
      case 6: scores[0] += -0.000516; scores[1] += -0.010311; scores[2] += -0.000176; scores[3] += 0.011003; break;
      case 7: scores[0] += -0.000011; scores[1] += 0.005648; scores[2] += -0.000008; scores[3] += -0.005629; break;
    }
  }

  // Tree 411 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[13] > 0.5694980621337891) << 1) | ((features[10] > 4.099999904632568) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005478; scores[1] += 0.003452; scores[2] += 0.005834; scores[3] += -0.014765; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000024; scores[1] += -0.006663; scores[2] += -0.000026; scores[3] += 0.006712; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.002710; scores[1] += 0.003334; scores[2] += -0.000746; scores[3] += 0.000123; break;
      case 5: scores[0] += 0.000170; scores[1] += 0.019061; scores[2] += -0.002944; scores[3] += -0.016288; break;
      case 6: scores[0] += -0.001018; scores[1] += -0.015231; scores[2] += -0.000302; scores[3] += 0.016551; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.003474; scores[2] += -0.000001; scores[3] += -0.003472; break;
    }
  }

  // Tree 412 (depth=3)
  {
    const leafIdx = ((features[14] > 0.5) << 0) | ((features[27] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009483; scores[1] += -0.000572; scores[2] += -0.020628; scores[3] += 0.011717; break;
      case 1: scores[0] += -0.002471; scores[1] += 0.007213; scores[2] += -0.000640; scores[3] += -0.004102; break;
      case 2: scores[0] += -0.000018; scores[1] += -0.001296; scores[2] += 0.016162; scores[3] += -0.014848; break;
      case 3: scores[0] += -0.000240; scores[1] += -0.016896; scores[2] += -0.000086; scores[3] += 0.017223; break;
      case 4: scores[0] += -0.005568; scores[1] += -0.019381; scores[2] += 0.013535; scores[3] += 0.011414; break;
      case 5: scores[0] += -0.000036; scores[1] += 0.022852; scores[2] += -0.000387; scores[3] += -0.022428; break;
      case 6: scores[0] += -0.000278; scores[1] += -0.000025; scores[2] += 0.019659; scores[3] += -0.019356; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 413 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[45] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000902; scores[1] += -0.006692; scores[2] += 0.005948; scores[3] += -0.000158; break;
      case 1: scores[0] += 0.000647; scores[1] += 0.021477; scores[2] += -0.018335; scores[3] += -0.003789; break;
      case 2: scores[0] += -0.001236; scores[1] += 0.013316; scores[2] += -0.016374; scores[3] += 0.004294; break;
      case 3: scores[0] += -0.000027; scores[1] += 0.019614; scores[2] += -0.000282; scores[3] += -0.019305; break;
      case 4: scores[0] += -0.003533; scores[1] += 0.004389; scores[2] += 0.007629; scores[3] += -0.008484; break;
      case 5: scores[0] += -0.000389; scores[1] += -0.000452; scores[2] += -0.000500; scores[3] += 0.001341; break;
      case 6: scores[0] += -0.001043; scores[1] += -0.004314; scores[2] += -0.004480; scores[3] += 0.009837; break;
      case 7: scores[0] += -0.000004; scores[1] += 0.000675; scores[2] += -0.000045; scores[3] += -0.000626; break;
    }
  }

  // Tree 414 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[45] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000640; scores[1] += -0.005194; scores[2] += 0.005104; scores[3] += -0.000550; break;
      case 1: scores[0] += 0.000645; scores[1] += 0.020775; scores[2] += -0.018058; scores[3] += -0.003362; break;
      case 2: scores[0] += -0.001273; scores[1] += 0.007988; scores[2] += -0.014939; scores[3] += 0.008224; break;
      case 3: scores[0] += -0.000027; scores[1] += 0.019393; scores[2] += -0.000285; scores[3] += -0.019081; break;
      case 4: scores[0] += -0.003531; scores[1] += 0.004282; scores[2] += 0.007321; scores[3] += -0.008073; break;
      case 5: scores[0] += -0.000388; scores[1] += -0.000445; scores[2] += -0.000500; scores[3] += 0.001333; break;
      case 6: scores[0] += -0.001034; scores[1] += -0.004767; scores[2] += -0.004040; scores[3] += 0.009841; break;
      case 7: scores[0] += -0.000004; scores[1] += 0.000674; scores[2] += -0.000045; scores[3] += -0.000625; break;
    }
  }

  // Tree 415 (depth=3)
  {
    const leafIdx = ((features[29] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[13] > 0.2928921580314636) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001624; scores[1] += 0.008297; scores[2] += -0.003266; scores[3] += -0.003407; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.001269; scores[1] += 0.028767; scores[2] += -0.000386; scores[3] += -0.027112; break;
      case 3: scores[0] += -0.000121; scores[1] += -0.022029; scores[2] += -0.000126; scores[3] += 0.022276; break;
      case 4: scores[0] += -0.000869; scores[1] += -0.037341; scores[2] += -0.000599; scores[3] += 0.038809; break;
      case 5: scores[0] += -0.000020; scores[1] += -0.026046; scores[2] += -0.000009; scores[3] += 0.026075; break;
      case 6: scores[0] += -0.001406; scores[1] += -0.001617; scores[2] += -0.000518; scores[3] += 0.003541; break;
      case 7: scores[0] += -0.000134; scores[1] += 0.038448; scores[2] += -0.000090; scores[3] += -0.038224; break;
    }
  }

  // Tree 416 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[29] > 0.5) << 1) | ((features[14] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001674; scores[1] += -0.007002; scores[2] += 0.002337; scores[3] += 0.002990; break;
      case 1: scores[0] += 0.000175; scores[1] += 0.016997; scores[2] += -0.002907; scores[3] += -0.014264; break;
      case 2: scores[0] += -0.000019; scores[1] += -0.025329; scores[2] += -0.000009; scores[3] += 0.025357; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.002526; scores[1] += 0.006793; scores[2] += -0.000876; scores[3] += -0.003391; break;
      case 5: scores[0] += -0.000019; scores[1] += 0.006078; scores[2] += -0.000006; scores[3] += -0.006054; break;
      case 6: scores[0] += -0.000265; scores[1] += 0.005772; scores[2] += -0.000228; scores[3] += -0.005279; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 417 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005959; scores[1] += 0.001696; scores[2] += -0.013286; scores[3] += 0.005631; break;
      case 1: scores[0] += -0.000009; scores[1] += 0.017761; scores[2] += -0.000027; scores[3] += -0.017726; break;
      case 2: scores[0] += 0.001029; scores[1] += -0.014669; scores[2] += 0.009160; scores[3] += 0.004480; break;
      case 3: scores[0] += -0.000250; scores[1] += -0.004696; scores[2] += -0.001606; scores[3] += 0.006552; break;
      case 4: scores[0] += -0.001043; scores[1] += 0.006482; scores[2] += -0.001130; scores[3] += -0.004310; break;
      case 5: scores[0] += -0.000006; scores[1] += -0.030599; scores[2] += -0.000004; scores[3] += 0.030608; break;
      case 6: scores[0] += -0.004150; scores[1] += -0.003685; scores[2] += -0.012059; scores[3] += 0.019894; break;
      case 7: scores[0] += -0.000069; scores[1] += -0.003977; scores[2] += -0.001096; scores[3] += 0.005142; break;
    }
  }

  // Tree 418 (depth=3)
  {
    const leafIdx = ((features[13] > 0.20344828069210052) << 0) | ((features[13] > 0.028991596773266792) << 1) | ((features[11] > 0.026671409606933594) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005202; scores[1] += 0.004101; scores[2] += -0.013211; scores[3] += 0.003908; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000078; scores[1] += 0.032459; scores[2] += -0.000075; scores[3] += -0.032306; break;
      case 3: scores[0] += -0.000901; scores[1] += -0.003289; scores[2] += -0.000985; scores[3] += 0.005176; break;
      case 4: scores[0] += 0.001795; scores[1] += -0.017120; scores[2] += 0.009278; scores[3] += 0.006047; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.001921; scores[1] += -0.001705; scores[2] += -0.012048; scores[3] += 0.015673; break;
      case 7: scores[0] += -0.002575; scores[1] += -0.007565; scores[2] += -0.000786; scores[3] += 0.010925; break;
    }
  }

  // Tree 419 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 8.225000381469727) << 1) | ((features[40] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.018539; scores[1] += 0.003361; scores[2] += 0.010734; scores[3] += 0.004444; break;
      case 1: scores[0] += -0.000568; scores[1] += -0.012683; scores[2] += 0.023541; scores[3] += -0.010290; break;
      case 2: scores[0] += 0.016922; scores[1] += -0.019660; scores[2] += 0.008016; scores[3] += -0.005278; break;
      case 3: scores[0] += -0.000163; scores[1] += -0.000105; scores[2] += -0.015463; scores[3] += 0.015730; break;
      case 4: scores[0] += 0.000371; scores[1] += 0.007832; scores[2] += 0.002958; scores[3] += -0.011161; break;
      case 5: scores[0] += -0.000604; scores[1] += -0.013526; scores[2] += -0.011887; scores[3] += 0.026017; break;
      case 6: scores[0] += -0.002769; scores[1] += 0.011032; scores[2] += -0.012906; scores[3] += 0.004643; break;
      case 7: scores[0] += -0.000400; scores[1] += -0.000136; scores[2] += -0.007007; scores[3] += 0.007544; break;
    }
  }

  // Tree 420 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025978408753871918) << 1) | ((features[42] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003786; scores[1] += -0.001714; scores[2] += -0.005689; scores[3] += 0.003617; break;
      case 1: scores[0] += -0.000034; scores[1] += -0.000193; scores[2] += 0.012950; scores[3] += -0.012722; break;
      case 2: scores[0] += -0.005312; scores[1] += 0.009969; scores[2] += -0.011069; scores[3] += 0.006412; break;
      case 3: scores[0] += -0.000009; scores[1] += -0.000063; scores[2] += -0.000485; scores[3] += 0.000556; break;
      case 4: scores[0] += -0.000780; scores[1] += 0.002790; scores[2] += 0.032126; scores[3] += -0.034135; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000270; scores[1] += -0.015684; scores[2] += -0.003666; scores[3] += 0.019620; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 421 (depth=3)
  {
    const leafIdx = ((features[11] > 0.09600614011287689) << 0) | ((features[34] > 0.25) << 1) | ((features[11] > 0.10172414034605026) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000012; scores[1] += 0.004847; scores[2] += -0.012597; scores[3] += 0.007763; break;
      case 1: scores[0] += 0.003528; scores[1] += -0.002677; scores[2] += -0.000464; scores[3] += -0.000388; break;
      case 2: scores[0] += -0.005456; scores[1] += 0.001228; scores[2] += 0.013453; scores[3] += -0.009225; break;
      case 3: scores[0] += -0.000526; scores[1] += -0.000107; scores[2] += -0.032675; scores[3] += 0.033307; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.006421; scores[1] += 0.010767; scores[2] += -0.011922; scores[3] += -0.005265; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += -0.000678; scores[1] += 0.009977; scores[2] += -0.008608; scores[3] += -0.000691; break;
    }
  }

  // Tree 422 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[43] > 0.28285714983940125) << 1) | ((features[2] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002960; scores[1] += -0.004561; scores[2] += 0.009417; scores[3] += -0.007816; break;
      case 1: scores[0] += -0.003972; scores[1] += 0.028154; scores[2] += -0.008271; scores[3] += -0.015912; break;
      case 2: scores[0] += -0.000450; scores[1] += -0.009897; scores[2] += -0.000195; scores[3] += 0.010542; break;
      case 3: scores[0] += -0.000003; scores[1] += -0.005249; scores[2] += -0.000002; scores[3] += 0.005255; break;
      case 4: scores[0] += -0.000067; scores[1] += -0.013404; scores[2] += -0.020886; scores[3] += 0.034357; break;
      case 5: scores[0] += 0.004646; scores[1] += -0.004145; scores[2] += -0.011162; scores[3] += 0.010661; break;
      case 6: scores[0] += -0.000083; scores[1] += -0.002252; scores[2] += -0.000018; scores[3] += 0.002353; break;
      case 7: scores[0] += -0.000007; scores[1] += 0.020515; scores[2] += -0.000011; scores[3] += -0.020496; break;
    }
  }

  // Tree 423 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[13] > 0.134848490357399) << 1) | ((features[11] > 0.05480480566620827) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001490; scores[1] += 0.013824; scores[2] += -0.008711; scores[3] += -0.003623; break;
      case 1: scores[0] += -0.000134; scores[1] += -0.000045; scores[2] += 0.016068; scores[3] += -0.015888; break;
      case 2: scores[0] += -0.001212; scores[1] += -0.002502; scores[2] += -0.001239; scores[3] += 0.004952; break;
      case 3: scores[0] += -0.000036; scores[1] += -0.004342; scores[2] += -0.000125; scores[3] += 0.004503; break;
      case 4: scores[0] += 0.003438; scores[1] += -0.006489; scores[2] += 0.000215; scores[3] += 0.002836; break;
      case 5: scores[0] += -0.000087; scores[1] += -0.000655; scores[2] += 0.006049; scores[3] += -0.005306; break;
      case 6: scores[0] += -0.003465; scores[1] += -0.003394; scores[2] += -0.001888; scores[3] += 0.008747; break;
      case 7: scores[0] += -0.000031; scores[1] += -0.000144; scores[2] += -0.000073; scores[3] += 0.000247; break;
    }
  }

  // Tree 424 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.0317540317773819) << 1) | ((features[13] > 0.08012820780277252) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002259; scores[1] += -0.003391; scores[2] += -0.000072; scores[3] += 0.001204; break;
      case 1: scores[0] += -0.000040; scores[1] += -0.000217; scores[2] += 0.012095; scores[3] += -0.011838; break;
      case 2: scores[0] += -0.000492; scores[1] += 0.046626; scores[2] += -0.012713; scores[3] += -0.033420; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.004945; scores[1] += 0.001253; scores[2] += -0.004507; scores[3] += 0.008199; break;
      case 7: scores[0] += -0.000003; scores[1] += -0.000038; scores[2] += -0.000097; scores[3] += 0.000138; break;
    }
  }

  // Tree 425 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[43] > 0.36602872610092163) << 1) | ((features[43] > 0.3603896200656891) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000452; scores[1] += -0.001800; scores[2] += 0.001861; scores[3] += 0.000391; break;
      case 1: scores[0] += -0.000087; scores[1] += 0.025007; scores[2] += -0.018759; scores[3] += -0.006160; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000013; scores[1] += 0.021832; scores[2] += -0.000003; scores[3] += -0.021817; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000343; scores[1] += -0.009771; scores[2] += -0.000147; scores[3] += 0.010260; break;
      case 7: scores[0] += -0.000004; scores[1] += 0.010607; scores[2] += -0.000005; scores[3] += -0.010598; break;
    }
  }

  // Tree 426 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 8.225000381469727) << 1) | ((features[11] > 0.05971479415893555) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.010074; scores[1] += 0.007023; scores[2] += -0.000241; scores[3] += 0.003292; break;
      case 1: scores[0] += -0.000079; scores[1] += -0.020017; scores[2] += 0.001819; scores[3] += 0.018278; break;
      case 2: scores[0] += 0.005930; scores[1] += -0.002802; scores[2] += 0.003732; scores[3] += -0.006860; break;
      case 3: scores[0] += -0.000371; scores[1] += -0.000211; scores[2] += -0.008858; scores[3] += 0.009440; break;
      case 4: scores[0] += -0.010746; scores[1] += 0.009822; scores[2] += 0.009660; scores[3] += -0.008736; break;
      case 5: scores[0] += -0.001203; scores[1] += -0.001960; scores[2] += 0.000790; scores[3] += 0.002373; break;
      case 6: scores[0] += 0.013317; scores[1] += -0.025698; scores[2] += 0.002702; scores[3] += 0.009678; break;
      case 7: scores[0] += -0.000189; scores[1] += -0.000031; scores[2] += -0.013601; scores[3] += 0.013820; break;
    }
  }

  // Tree 427 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001638; scores[1] += 0.000866; scores[2] += -0.002581; scores[3] += 0.003353; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.001440; scores[1] += 0.002735; scores[2] += 0.001273; scores[3] += -0.005447; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000204; scores[1] += 0.011996; scores[2] += -0.000685; scores[3] += -0.011106; break;
      case 5: scores[0] += -0.000009; scores[1] += -0.000062; scores[2] += -0.000498; scores[3] += 0.000568; break;
      case 6: scores[0] += -0.001552; scores[1] += -0.008326; scores[2] += -0.018164; scores[3] += 0.028043; break;
      case 7: scores[0] += -0.000033; scores[1] += -0.000186; scores[2] += 0.012292; scores[3] += -0.012073; break;
    }
  }

  // Tree 428 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.07362240552902222) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005375; scores[1] += -0.005207; scores[2] += 0.012722; scores[3] += -0.002140; break;
      case 1: scores[0] += -0.001160; scores[1] += -0.000086; scores[2] += -0.019583; scores[3] += 0.020829; break;
      case 2: scores[0] += 0.008813; scores[1] += -0.001970; scores[2] += -0.004988; scores[3] += -0.001855; break;
      case 3: scores[0] += -0.000449; scores[1] += -0.000225; scores[2] += 0.024338; scores[3] += -0.023664; break;
      case 4: scores[0] += -0.001848; scores[1] += 0.003921; scores[2] += -0.001846; scores[3] += -0.000226; break;
      case 5: scores[0] += -0.000076; scores[1] += -0.019256; scores[2] += -0.000809; scores[3] += 0.020141; break;
      case 6: scores[0] += -0.003823; scores[1] += 0.010557; scores[2] += -0.011593; scores[3] += 0.004860; break;
      case 7: scores[0] += -0.000060; scores[1] += -0.001522; scores[2] += -0.002268; scores[3] += 0.003850; break;
    }
  }

  // Tree 429 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000066; scores[1] += -0.004771; scores[2] += 0.005877; scores[3] += -0.001041; break;
      case 1: scores[0] += -0.001507; scores[1] += 0.001426; scores[2] += -0.001323; scores[3] += 0.001404; break;
      case 2: scores[0] += -0.001953; scores[1] += 0.004229; scores[2] += -0.013896; scores[3] += 0.011620; break;
      case 3: scores[0] += -0.000076; scores[1] += 0.016375; scores[2] += -0.000069; scores[3] += -0.016230; break;
      case 4: scores[0] += 0.000413; scores[1] += 0.018025; scores[2] += -0.017382; scores[3] += -0.001056; break;
      case 5: scores[0] += -0.000176; scores[1] += 0.000861; scores[2] += -0.000913; scores[3] += 0.000228; break;
      case 6: scores[0] += -0.000030; scores[1] += 0.017412; scores[2] += -0.000320; scores[3] += -0.017063; break;
      case 7: scores[0] += -0.000000; scores[1] += 0.002264; scores[2] += -0.000001; scores[3] += -0.002263; break;
    }
  }

  // Tree 430 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[38] > 0.5) << 1) | ((features[18] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001938; scores[1] += 0.003547; scores[2] += -0.003794; scores[3] += 0.002185; break;
      case 1: scores[0] += -0.000009; scores[1] += -0.000060; scores[2] += -0.000481; scores[3] += 0.000549; break;
      case 2: scores[0] += 0.003510; scores[1] += -0.004451; scores[2] += -0.002310; scores[3] += 0.003251; break;
      case 3: scores[0] += -0.000033; scores[1] += -0.000184; scores[2] += 0.011913; scores[3] += -0.011696; break;
      case 4: scores[0] += -0.000030; scores[1] += -0.006130; scores[2] += -0.000121; scores[3] += 0.006281; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000164; scores[1] += -0.000125; scores[2] += 0.015343; scores[3] += -0.015055; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 431 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006229; scores[1] += 0.001099; scores[2] += -0.012591; scores[3] += 0.005263; break;
      case 1: scores[0] += -0.000009; scores[1] += 0.017299; scores[2] += -0.000025; scores[3] += -0.017265; break;
      case 2: scores[0] += 0.000920; scores[1] += -0.014210; scores[2] += 0.008828; scores[3] += 0.004462; break;
      case 3: scores[0] += -0.000234; scores[1] += -0.004346; scores[2] += -0.002698; scores[3] += 0.007278; break;
      case 4: scores[0] += -0.001004; scores[1] += 0.006288; scores[2] += -0.001104; scores[3] += -0.004180; break;
      case 5: scores[0] += -0.000005; scores[1] += -0.031699; scores[2] += -0.000004; scores[3] += 0.031708; break;
      case 6: scores[0] += -0.003957; scores[1] += -0.002995; scores[2] += -0.011686; scores[3] += 0.018638; break;
      case 7: scores[0] += -0.000064; scores[1] += -0.003857; scores[2] += -0.001047; scores[3] += 0.004969; break;
    }
  }

  // Tree 432 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[10] > 13.833333969116211) << 1) | ((features[13] > 0.4558441638946533) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.006577; scores[1] += 0.002120; scores[2] += 0.001676; scores[3] += 0.002781; break;
      case 1: scores[0] += -0.000178; scores[1] += 0.010512; scores[2] += -0.000061; scores[3] += -0.010273; break;
      case 2: scores[0] += 0.014220; scores[1] += -0.001983; scores[2] += -0.001869; scores[3] += -0.010368; break;
      case 3: scores[0] += -0.000900; scores[1] += -0.010949; scores[2] += -0.000128; scores[3] += 0.011977; break;
      case 4: scores[0] += -0.000666; scores[1] += -0.005063; scores[2] += -0.000723; scores[3] += 0.006452; break;
      case 5: scores[0] += -0.000012; scores[1] += 0.029095; scores[2] += -0.000006; scores[3] += -0.029077; break;
      case 6: scores[0] += -0.000587; scores[1] += -0.005734; scores[2] += -0.000062; scores[3] += 0.006383; break;
      case 7: scores[0] += -0.000077; scores[1] += 0.002919; scores[2] += -0.000025; scores[3] += -0.002816; break;
    }
  }

  // Tree 433 (depth=3)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[10] > 11.291666030883789) << 1) | ((features[11] > 0.0674242451786995) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008725; scores[1] += 0.004323; scores[2] += -0.002459; scores[3] += 0.006861; break;
      case 1: scores[0] += -0.003260; scores[1] += 0.010393; scores[2] += -0.009941; scores[3] += 0.002808; break;
      case 2: scores[0] += 0.011126; scores[1] += 0.003327; scores[2] += -0.006527; scores[3] += -0.007926; break;
      case 3: scores[0] += -0.000294; scores[1] += -0.001227; scores[2] += 0.018775; scores[3] += -0.017254; break;
      case 4: scores[0] += -0.002496; scores[1] += 0.013639; scores[2] += -0.020246; scores[3] += 0.009103; break;
      case 5: scores[0] += -0.002670; scores[1] += 0.006180; scores[2] += 0.006048; scores[3] += -0.009558; break;
      case 6: scores[0] += 0.014344; scores[1] += -0.015102; scores[2] += -0.002044; scores[3] += 0.002802; break;
      case 7: scores[0] += -0.000266; scores[1] += -0.000487; scores[2] += 0.015508; scores[3] += -0.014755; break;
    }
  }

  // Tree 434 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.025320513173937798) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006643; scores[1] += 0.001007; scores[2] += -0.012110; scores[3] += 0.004459; break;
      case 1: scores[0] += -0.000013; scores[1] += 0.011738; scores[2] += -0.000027; scores[3] += -0.011698; break;
      case 2: scores[0] += 0.001027; scores[1] += -0.013940; scores[2] += 0.008532; scores[3] += 0.004381; break;
      case 3: scores[0] += -0.000253; scores[1] += -0.004386; scores[2] += -0.002585; scores[3] += 0.007224; break;
      case 4: scores[0] += -0.000994; scores[1] += 0.005845; scores[2] += -0.001087; scores[3] += -0.003764; break;
      case 5: scores[0] += -0.000002; scores[1] += -0.029148; scores[2] += -0.000002; scores[3] += 0.029152; break;
      case 6: scores[0] += -0.003900; scores[1] += -0.002339; scores[2] += -0.011577; scores[3] += 0.017816; break;
      case 7: scores[0] += -0.000038; scores[1] += -0.003761; scores[2] += -0.000830; scores[3] += 0.004629; break;
    }
  }

  // Tree 435 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[10] > 9.583333969116211) << 1) | ((features[5] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.015502; scores[1] += 0.004736; scores[2] += 0.005874; scores[3] += 0.004892; break;
      case 1: scores[0] += 0.004457; scores[1] += -0.000409; scores[2] += -0.000069; scores[3] += -0.003980; break;
      case 2: scores[0] += 0.011797; scores[1] += -0.001073; scores[2] += -0.008793; scores[3] += -0.001931; break;
      case 3: scores[0] += 0.001147; scores[1] += -0.000017; scores[2] += -0.000011; scores[3] += -0.001120; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000885; scores[1] += -0.000013; scores[2] += -0.000009; scores[3] += -0.000862; break;
      case 7: scores[0] += 0.003859; scores[1] += -0.000055; scores[2] += -0.000171; scores[3] += -0.003633; break;
    }
  }

  // Tree 436 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.009200; scores[1] += -0.002370; scores[2] += -0.004926; scores[3] += -0.001904; break;
      case 1: scores[0] += 0.002257; scores[1] += -0.003160; scores[2] += -0.022920; scores[3] += 0.023824; break;
      case 2: scores[0] += -0.004155; scores[1] += -0.006886; scores[2] += 0.017212; scores[3] += -0.006171; break;
      case 3: scores[0] += -0.001452; scores[1] += -0.000054; scores[2] += -0.018695; scores[3] += 0.020201; break;
      case 4: scores[0] += -0.003566; scores[1] += 0.002522; scores[2] += -0.001595; scores[3] += 0.002639; break;
      case 5: scores[0] += -0.001378; scores[1] += -0.006107; scores[2] += -0.000161; scores[3] += 0.007646; break;
      case 6: scores[0] += -0.000468; scores[1] += 0.011825; scores[2] += -0.011902; scores[3] += 0.000545; break;
      case 7: scores[0] += -0.000199; scores[1] += 0.007287; scores[2] += -0.002670; scores[3] += -0.004419; break;
    }
  }

  // Tree 437 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002600; scores[1] += 0.001228; scores[2] += -0.000127; scores[3] += 0.001499; break;
      case 1: scores[0] += 0.005433; scores[1] += -0.000422; scores[2] += -0.000078; scores[3] += -0.004933; break;
      case 2: scores[0] += 0.000875; scores[1] += -0.000013; scores[2] += -0.000009; scores[3] += -0.000852; break;
      case 3: scores[0] += 0.003822; scores[1] += -0.000054; scores[2] += -0.000168; scores[3] += -0.003599; break;
      case 4: scores[0] += -0.000009; scores[1] += 0.005861; scores[2] += -0.000097; scores[3] += -0.005755; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 438 (depth=3)
  {
    const leafIdx = ((features[43] > 0.24500000476837158) << 0) | ((features[13] > 0.3380952477455139) << 1) | ((features[13] > 0.3291666507720947) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001539; scores[1] += 0.011527; scores[2] += -0.005121; scores[3] += -0.004867; break;
      case 1: scores[0] += -0.000250; scores[1] += -0.013047; scores[2] += -0.000132; scores[3] += 0.013429; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000273; scores[1] += 0.008671; scores[2] += -0.000023; scores[3] += -0.008375; break;
      case 5: scores[0] += -0.000041; scores[1] += -0.023179; scores[2] += -0.000016; scores[3] += 0.023235; break;
      case 6: scores[0] += -0.001401; scores[1] += -0.002945; scores[2] += -0.001080; scores[3] += 0.005427; break;
      case 7: scores[0] += -0.000387; scores[1] += -0.003992; scores[2] += -0.000166; scores[3] += 0.004545; break;
    }
  }

  // Tree 439 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.550000190734863) << 1) | ((features[46] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.018020; scores[1] += 0.005045; scores[2] += 0.007747; scores[3] += 0.005228; break;
      case 1: scores[0] += -0.000050; scores[1] += -0.000022; scores[2] += 0.012216; scores[3] += -0.012143; break;
      case 2: scores[0] += 0.010739; scores[1] += 0.000280; scores[2] += -0.010934; scores[3] += -0.000085; break;
      case 3: scores[0] += -0.000176; scores[1] += -0.004544; scores[2] += 0.008206; scores[3] += -0.003485; break;
      case 4: scores[0] += -0.000178; scores[1] += -0.001660; scores[2] += 0.013372; scores[3] += -0.011534; break;
      case 5: scores[0] += -0.000022; scores[1] += -0.000813; scores[2] += 0.001801; scores[3] += -0.000966; break;
      case 6: scores[0] += -0.000475; scores[1] += 0.000882; scores[2] += 0.007537; scores[3] += -0.007945; break;
      case 7: scores[0] += -0.000022; scores[1] += -0.000143; scores[2] += 0.000217; scores[3] += -0.000052; break;
    }
  }

  // Tree 440 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[10] > 9.583333969116211) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.014750; scores[1] += 0.004151; scores[2] += 0.005639; scores[3] += 0.004959; break;
      case 1: scores[0] += 0.004442; scores[1] += -0.000416; scores[2] += -0.000069; scores[3] += -0.003957; break;
      case 2: scores[0] += 0.011067; scores[1] += -0.001252; scores[2] += -0.007201; scores[3] += -0.002614; break;
      case 3: scores[0] += 0.004720; scores[1] += -0.000070; scores[2] += -0.000172; scores[3] += -0.004479; break;
      case 4: scores[0] += -0.000009; scores[1] += 0.005732; scores[2] += -0.000096; scores[3] += -0.005627; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 441 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[13] > 0.563858687877655) << 1) | ((features[10] > 3.5833334922790527) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000001; scores[1] += 0.008287; scores[2] += -0.000004; scores[3] += -0.008281; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.000003; scores[1] += -0.002134; scores[2] += -0.000005; scores[3] += 0.002142; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.000124; scores[1] += 0.001459; scores[2] += -0.000809; scores[3] += -0.000774; break;
      case 5: scores[0] += 0.000055; scores[1] += 0.018144; scores[2] += -0.002688; scores[3] += -0.015511; break;
      case 6: scores[0] += -0.000945; scores[1] += -0.014548; scores[2] += -0.000284; scores[3] += 0.015777; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.003307; scores[2] += -0.000000; scores[3] += -0.003305; break;
    }
  }

  // Tree 442 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.633333206176758) << 1) | ((features[46] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.017488; scores[1] += 0.005862; scores[2] += 0.007150; scores[3] += 0.004475; break;
      case 1: scores[0] += -0.000050; scores[1] += -0.000022; scores[2] += 0.012138; scores[3] += -0.012066; break;
      case 2: scores[0] += 0.010303; scores[1] += -0.000680; scores[2] += -0.009803; scores[3] += 0.000180; break;
      case 3: scores[0] += -0.000173; scores[1] += -0.004539; scores[2] += 0.008129; scores[3] += -0.003416; break;
      case 4: scores[0] += -0.000177; scores[1] += -0.001699; scores[2] += 0.013127; scores[3] += -0.011252; break;
      case 5: scores[0] += -0.000022; scores[1] += -0.000812; scores[2] += 0.001796; scores[3] += -0.000962; break;
      case 6: scores[0] += -0.000458; scores[1] += 0.000875; scores[2] += 0.007431; scores[3] += -0.007847; break;
      case 7: scores[0] += -0.000022; scores[1] += -0.000142; scores[2] += 0.000217; scores[3] += -0.000053; break;
    }
  }

  // Tree 443 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.025320513173937798) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.010993; scores[1] += -0.034869; scores[2] += 0.011797; scores[3] += 0.012078; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.005212; scores[1] += 0.013985; scores[2] += -0.012339; scores[3] += 0.003566; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.005419; scores[1] += 0.044395; scores[2] += -0.012225; scores[3] += -0.026751; break;
      case 5: scores[0] += -0.000029; scores[1] += -0.000181; scores[2] += 0.011539; scores[3] += -0.011329; break;
      case 6: scores[0] += -0.000161; scores[1] += -0.033515; scores[2] += -0.001425; scores[3] += 0.035101; break;
      case 7: scores[0] += -0.000008; scores[1] += -0.000060; scores[2] += -0.000475; scores[3] += 0.000543; break;
    }
  }

  // Tree 444 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[31] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.010583; scores[1] += -0.009655; scores[2] += 0.003939; scores[3] += -0.004867; break;
      case 1: scores[0] += -0.003809; scores[1] += -0.008252; scores[2] += -0.013633; scores[3] += 0.025693; break;
      case 2: scores[0] += -0.016253; scores[1] += 0.030118; scores[2] += -0.014527; scores[3] += 0.000661; break;
      case 3: scores[0] += -0.000003; scores[1] += 0.020503; scores[2] += -0.000001; scores[3] += -0.020499; break;
      case 4: scores[0] += -0.004889; scores[1] += 0.026197; scores[2] += -0.004642; scores[3] += -0.016666; break;
      case 5: scores[0] += -0.000145; scores[1] += -0.008136; scores[2] += -0.018123; scores[3] += 0.026404; break;
      case 6: scores[0] += -0.000234; scores[1] += -0.009927; scores[2] += -0.000096; scores[3] += 0.010257; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 445 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 8.225000381469727) << 1) | ((features[40] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.015840; scores[1] += 0.002475; scores[2] += 0.009359; scores[3] += 0.004005; break;
      case 1: scores[0] += -0.000530; scores[1] += -0.012186; scores[2] += 0.020941; scores[3] += -0.008225; break;
      case 2: scores[0] += 0.014365; scores[1] += -0.017919; scores[2] += 0.009422; scores[3] += -0.005868; break;
      case 3: scores[0] += -0.000157; scores[1] += -0.000097; scores[2] += -0.014651; scores[3] += 0.014905; break;
      case 4: scores[0] += 0.001085; scores[1] += 0.006408; scores[2] += 0.002852; scores[3] += -0.010345; break;
      case 5: scores[0] += -0.000566; scores[1] += -0.013028; scores[2] += -0.012206; scores[3] += 0.025800; break;
      case 6: scores[0] += -0.003742; scores[1] += 0.011250; scores[2] += -0.010501; scores[3] += 0.002992; break;
      case 7: scores[0] += -0.000387; scores[1] += -0.000125; scores[2] += -0.006563; scores[3] += 0.007075; break;
    }
  }

  // Tree 446 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.07229965180158615) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004966; scores[1] += -0.004693; scores[2] += 0.012178; scores[3] += -0.002519; break;
      case 1: scores[0] += -0.001101; scores[1] += -0.000083; scores[2] += -0.018443; scores[3] += 0.019627; break;
      case 2: scores[0] += 0.007772; scores[1] += -0.001574; scores[2] += -0.004235; scores[3] += -0.001963; break;
      case 3: scores[0] += -0.000421; scores[1] += -0.000222; scores[2] += 0.022162; scores[3] += -0.021519; break;
      case 4: scores[0] += -0.001806; scores[1] += 0.003252; scores[2] += -0.001707; scores[3] += 0.000260; break;
      case 5: scores[0] += -0.000069; scores[1] += -0.019190; scores[2] += -0.000744; scores[3] += 0.020003; break;
      case 6: scores[0] += -0.003840; scores[1] += 0.011306; scores[2] += -0.010907; scores[3] += 0.003441; break;
      case 7: scores[0] += -0.000055; scores[1] += -0.001548; scores[2] += -0.002163; scores[3] += 0.003766; break;
    }
  }

  // Tree 447 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.010204081423580647) << 1) | ((features[44] > 0.15000000596046448) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.032847; scores[1] += -0.006348; scores[2] += -0.002540; scores[3] += -0.023959; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.003643; scores[1] += -0.002550; scores[2] += -0.000313; scores[3] += 0.006507; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.038706; scores[1] += 0.010315; scores[2] += 0.013243; scores[3] += 0.015148; break;
      case 5: scores[0] += -0.000028; scores[1] += -0.000179; scores[2] += 0.010882; scores[3] += -0.010675; break;
      case 6: scores[0] += -0.001877; scores[1] += 0.008806; scores[2] += -0.013376; scores[3] += 0.006447; break;
      case 7: scores[0] += -0.000008; scores[1] += -0.000061; scores[2] += -0.000490; scores[3] += 0.000559; break;
    }
  }

  // Tree 448 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 8.708333969116211) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.013665; scores[1] += 0.003684; scores[2] += 0.005989; scores[3] += 0.003992; break;
      case 1: scores[0] += -0.005691; scores[1] += 0.005727; scores[2] += -0.012201; scores[3] += 0.012165; break;
      case 2: scores[0] += -0.003525; scores[1] += 0.006152; scores[2] += 0.001683; scores[3] += -0.004311; break;
      case 3: scores[0] += -0.000368; scores[1] += 0.009117; scores[2] += -0.020273; scores[3] += 0.011524; break;
      case 4: scores[0] += 0.023469; scores[1] += -0.003051; scores[2] += -0.017139; scores[3] += -0.003279; break;
      case 5: scores[0] += 0.004063; scores[1] += -0.012267; scores[2] += -0.014700; scores[3] += 0.022903; break;
      case 6: scores[0] += -0.000971; scores[1] += -0.004801; scores[2] += 0.031735; scores[3] += -0.025963; break;
      case 7: scores[0] += -0.001265; scores[1] += -0.001196; scores[2] += -0.009926; scores[3] += 0.012386; break;
    }
  }

  // Tree 449 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.11882352828979492) << 1) | ((features[13] > 0.04446640610694885) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000334; scores[1] += 0.003333; scores[2] += -0.002560; scores[3] += -0.001107; break;
      case 1: scores[0] += -0.000033; scores[1] += -0.000209; scores[2] += 0.010274; scores[3] += -0.010032; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000509; scores[1] += 0.037756; scores[2] += -0.003420; scores[3] += -0.033826; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.004534; scores[1] += -0.000387; scores[2] += -0.002978; scores[3] += 0.007898; break;
      case 7: scores[0] += -0.000003; scores[1] += -0.000035; scores[2] += -0.000090; scores[3] += 0.000127; break;
    }
  }

  // Tree 450 (depth=3)
  {
    const leafIdx = ((features[47] > 0.8166666626930237) << 0) | ((features[1] > 0.5) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000519; scores[1] += -0.003588; scores[2] += 0.001219; scores[3] += 0.001850; break;
      case 1: scores[0] += -0.000002; scores[1] += -0.000111; scores[2] += -0.000001; scores[3] += 0.000114; break;
      case 2: scores[0] += -0.000054; scores[1] += 0.019655; scores[2] += -0.002590; scores[3] += -0.017011; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.001392; scores[1] += 0.013416; scores[2] += -0.000219; scores[3] += -0.011805; break;
      case 5: scores[0] += -0.000004; scores[1] += -0.004409; scores[2] += -0.000001; scores[3] += 0.004414; break;
      case 6: scores[0] += -0.000015; scores[1] += 0.000399; scores[2] += -0.000004; scores[3] += -0.000380; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 451 (depth=3)
  {
    const leafIdx = ((features[47] > 0.7166666984558105) << 0) | ((features[26] > 0.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000509; scores[1] += -0.003765; scores[2] += 0.003032; scores[3] += 0.001242; break;
      case 1: scores[0] += 0.000891; scores[1] += -0.000722; scores[2] += -0.000033; scores[3] += -0.000137; break;
      case 2: scores[0] += -0.001369; scores[1] += 0.011395; scores[2] += -0.000210; scores[3] += -0.009816; break;
      case 3: scores[0] += -0.000020; scores[1] += -0.012669; scores[2] += -0.000005; scores[3] += 0.012693; break;
      case 4: scores[0] += 0.000648; scores[1] += 0.018981; scores[2] += -0.018012; scores[3] += -0.001618; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000008; scores[1] += 0.018014; scores[2] += -0.000007; scores[3] += -0.017998; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 452 (depth=3)
  {
    const leafIdx = ((features[9] > 5.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006091; scores[1] += 0.001652; scores[2] += -0.011808; scores[3] += 0.004065; break;
      case 1: scores[0] += -0.000007; scores[1] += 0.017061; scores[2] += -0.000026; scores[3] += -0.017028; break;
      case 2: scores[0] += 0.000009; scores[1] += -0.013792; scores[2] += 0.009125; scores[3] += 0.004657; break;
      case 3: scores[0] += -0.000198; scores[1] += -0.004556; scores[2] += -0.004271; scores[3] += 0.009025; break;
      case 4: scores[0] += -0.000974; scores[1] += 0.005612; scores[2] += -0.001038; scores[3] += -0.003600; break;
      case 5: scores[0] += -0.000005; scores[1] += -0.030151; scores[2] += -0.000003; scores[3] += 0.030160; break;
      case 6: scores[0] += -0.003959; scores[1] += -0.002161; scores[2] += -0.010980; scores[3] += 0.017100; break;
      case 7: scores[0] += -0.000058; scores[1] += -0.003594; scores[2] += -0.001033; scores[3] += 0.004685; break;
    }
  }

  // Tree 453 (depth=3)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[35] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004290; scores[1] += -0.006766; scores[2] += 0.012737; scores[3] += -0.010261; break;
      case 1: scores[0] += -0.006789; scores[1] += 0.002820; scores[2] += -0.022640; scores[3] += 0.026608; break;
      case 2: scores[0] += -0.011724; scores[1] += 0.015851; scores[2] += -0.011059; scores[3] += 0.006932; break;
      case 3: scores[0] += -0.000003; scores[1] += 0.020126; scores[2] += -0.000001; scores[3] += -0.020123; break;
      case 4: scores[0] += 0.005795; scores[1] += 0.011764; scores[2] += -0.037189; scores[3] += 0.019630; break;
      case 5: scores[0] += 0.003642; scores[1] += -0.022876; scores[2] += -0.005419; scores[3] += 0.024653; break;
      case 6: scores[0] += -0.003946; scores[1] += 0.015281; scores[2] += -0.003233; scores[3] += -0.008103; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 454 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.001497; scores[1] += -0.008555; scores[2] += 0.005827; scores[3] += 0.001231; break;
      case 1: scores[0] += 0.000835; scores[1] += 0.019510; scores[2] += -0.017793; scores[3] += -0.002552; break;
      case 2: scores[0] += -0.001046; scores[1] += 0.011657; scores[2] += -0.015831; scores[3] += 0.005219; break;
      case 3: scores[0] += -0.000024; scores[1] += 0.018388; scores[2] += -0.000291; scores[3] += -0.018073; break;
      case 4: scores[0] += -0.003829; scores[1] += 0.012654; scores[2] += 0.006760; scores[3] += -0.015585; break;
      case 5: scores[0] += -0.000354; scores[1] += -0.000695; scores[2] += -0.000446; scores[3] += 0.001495; break;
      case 6: scores[0] += -0.000833; scores[1] += -0.003252; scores[2] += -0.006823; scores[3] += 0.010908; break;
      case 7: scores[0] += -0.000003; scores[1] += 0.000599; scores[2] += -0.000037; scores[3] += -0.000560; break;
    }
  }

  // Tree 455 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[8] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003702; scores[1] += 0.002385; scores[2] += -0.000415; scores[3] += 0.001732; break;
      case 1: scores[0] += 0.004368; scores[1] += -0.000392; scores[2] += -0.000073; scores[3] += -0.003903; break;
      case 2: scores[0] += 0.000749; scores[1] += -0.000011; scores[2] += -0.000008; scores[3] += -0.000730; break;
      case 3: scores[0] += 0.002128; scores[1] += -0.000025; scores[2] += -0.000084; scores[3] += -0.002018; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000975; scores[1] += -0.000014; scores[2] += -0.000009; scores[3] += -0.000952; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.001303; scores[1] += -0.000021; scores[2] += -0.000070; scores[3] += -0.001212; break;
    }
  }

  // Tree 456 (depth=3)
  {
    const leafIdx = ((features[47] > 0.8166666626930237) << 0) | ((features[30] > 0.5) << 1) | ((features[43] > 0.043478261679410934) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000008; scores[1] += -0.012896; scores[2] += 0.007500; scores[3] += 0.005388; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.002276; scores[1] += 0.045104; scores[2] += -0.030412; scores[3] += -0.012416; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000655; scores[1] += 0.010340; scores[2] += -0.000390; scores[3] += -0.009294; break;
      case 5: scores[0] += -0.000004; scores[1] += -0.004299; scores[2] += -0.000001; scores[3] += 0.004303; break;
      case 6: scores[0] += -0.000557; scores[1] += -0.041173; scores[2] += -0.000113; scores[3] += 0.041843; break;
      case 7: scores[0] += -0.000003; scores[1] += -0.000111; scores[2] += -0.000001; scores[3] += 0.000114; break;
    }
  }

  // Tree 457 (depth=3)
  {
    const leafIdx = ((features[42] > 0.5) << 0) | ((features[13] > 0.027402402833104134) << 1) | ((features[13] > 0.08514492958784103) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002866; scores[1] += 0.000179; scores[2] += -0.005274; scores[3] += 0.002229; break;
      case 1: scores[0] += -0.000643; scores[1] += 0.002726; scores[2] += 0.029602; scores[3] += -0.031684; break;
      case 2: scores[0] += -0.000612; scores[1] += 0.039099; scores[2] += -0.012287; scores[3] += -0.026200; break;
      case 3: scores[0] += -0.000022; scores[1] += -0.000092; scores[2] += -0.001260; scores[3] += 0.001374; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.004542; scores[1] += -0.000167; scores[2] += -0.001515; scores[3] += 0.006224; break;
      case 7: scores[0] += -0.000222; scores[1] += -0.015440; scores[2] += -0.002451; scores[3] += 0.018113; break;
    }
  }

  // Tree 458 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.007556; scores[1] += 0.000491; scores[2] += -0.006325; scores[3] += -0.001723; break;
      case 1: scores[0] += 0.001641; scores[1] += -0.003017; scores[2] += -0.021008; scores[3] += 0.022384; break;
      case 2: scores[0] += -0.003823; scores[1] += -0.006958; scores[2] += 0.016130; scores[3] += -0.005350; break;
      case 3: scores[0] += -0.001431; scores[1] += -0.000054; scores[2] += -0.017027; scores[3] += 0.018512; break;
      case 4: scores[0] += -0.003551; scores[1] += 0.002241; scores[2] += -0.001477; scores[3] += 0.002787; break;
      case 5: scores[0] += -0.001322; scores[1] += -0.005493; scores[2] += -0.000139; scores[3] += 0.006954; break;
      case 6: scores[0] += -0.000459; scores[1] += 0.010705; scores[2] += -0.011557; scores[3] += 0.001312; break;
      case 7: scores[0] += -0.000203; scores[1] += 0.006678; scores[2] += -0.002491; scores[3] += -0.003985; break;
    }
  }

  // Tree 459 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[34] > 0.3500000238418579) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003000; scores[1] += -0.005826; scores[2] += 0.014382; scores[3] += -0.005556; break;
      case 1: scores[0] += 0.000288; scores[1] += 0.017163; scores[2] += -0.008894; scores[3] += -0.008557; break;
      case 2: scores[0] += -0.001581; scores[1] += 0.013842; scores[2] += -0.030906; scores[3] += 0.018645; break;
      case 3: scores[0] += -0.000026; scores[1] += 0.018365; scores[2] += -0.000322; scores[3] += -0.018017; break;
      case 4: scores[0] += -0.001140; scores[1] += -0.013914; scores[2] += -0.003377; scores[3] += 0.018431; break;
      case 5: scores[0] += -0.000163; scores[1] += -0.001079; scores[2] += -0.009337; scores[3] += 0.010579; break;
      case 6: scores[0] += -0.000149; scores[1] += -0.009824; scores[2] += 0.016529; scores[3] += -0.006557; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 460 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.07362240552902222) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005081; scores[1] += -0.001656; scores[2] += 0.009176; scores[3] += -0.002440; break;
      case 1: scores[0] += -0.000996; scores[1] += -0.000076; scores[2] += -0.017778; scores[3] += 0.018851; break;
      case 2: scores[0] += 0.007757; scores[1] += -0.001735; scores[2] += -0.004344; scores[3] += -0.001679; break;
      case 3: scores[0] += -0.000390; scores[1] += -0.000204; scores[2] += 0.021093; scores[3] += -0.020500; break;
      case 4: scores[0] += -0.001740; scores[1] += 0.002930; scores[2] += -0.001702; scores[3] += 0.000512; break;
      case 5: scores[0] += -0.000067; scores[1] += -0.018503; scores[2] += -0.000724; scores[3] += 0.019294; break;
      case 6: scores[0] += -0.003657; scores[1] += 0.010814; scores[2] += -0.010803; scores[3] += 0.003646; break;
      case 7: scores[0] += -0.000053; scores[1] += -0.001557; scores[2] += -0.002105; scores[3] += 0.003715; break;
    }
  }

  // Tree 461 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[13] > 0.4558441638946533) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.002148; scores[1] += 0.002599; scores[2] += -0.003654; scores[3] += -0.001092; break;
      case 1: scores[0] += -0.000212; scores[1] += 0.007112; scores[2] += -0.000062; scores[3] += -0.006838; break;
      case 2: scores[0] += 0.001836; scores[1] += -0.022142; scores[2] += 0.008679; scores[3] += 0.011628; break;
      case 3: scores[0] += -0.000821; scores[1] += -0.012823; scores[2] += -0.000103; scores[3] += 0.013747; break;
      case 4: scores[0] += -0.001114; scores[1] += -0.005075; scores[2] += -0.000697; scores[3] += 0.006886; break;
      case 5: scores[0] += -0.000036; scores[1] += 0.024778; scores[2] += -0.000013; scores[3] += -0.024729; break;
      case 6: scores[0] += -0.000066; scores[1] += -0.005516; scores[2] += -0.000026; scores[3] += 0.005608; break;
      case 7: scores[0] += -0.000052; scores[1] += -0.002194; scores[2] += -0.000014; scores[3] += 0.002261; break;
    }
  }

  // Tree 462 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[16] > 0.5) << 1) | ((features[9] > 3.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000639; scores[1] += 0.002965; scores[2] += 0.009841; scores[3] += -0.012167; break;
      case 1: scores[0] += 0.004006; scores[1] += 0.001493; scores[2] += -0.005108; scores[3] += -0.000392; break;
      case 2: scores[0] += -0.000025; scores[1] += -0.000044; scores[2] += 0.006381; scores[3] += -0.006312; break;
      case 3: scores[0] += -0.000090; scores[1] += -0.003083; scores[2] += -0.000275; scores[3] += 0.003448; break;
      case 4: scores[0] += -0.000889; scores[1] += -0.011836; scores[2] += 0.000670; scores[3] += 0.012056; break;
      case 5: scores[0] += -0.011070; scores[1] += 0.015739; scores[2] += -0.003981; scores[3] += -0.000688; break;
      case 6: scores[0] += -0.000017; scores[1] += -0.003427; scores[2] += 0.004154; scores[3] += -0.000711; break;
      case 7: scores[0] += -0.000007; scores[1] += -0.000046; scores[2] += 0.000313; scores[3] += -0.000260; break;
    }
  }

  // Tree 463 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000520; scores[1] += -0.004810; scores[2] += 0.006099; scores[3] += -0.000768; break;
      case 1: scores[0] += -0.001405; scores[1] += 0.001684; scores[2] += -0.001303; scores[3] += 0.001025; break;
      case 2: scores[0] += -0.001644; scores[1] += 0.005557; scores[2] += -0.015199; scores[3] += 0.011285; break;
      case 3: scores[0] += -0.000068; scores[1] += 0.016499; scores[2] += -0.000062; scores[3] += -0.016369; break;
      case 4: scores[0] += 0.000711; scores[1] += 0.017128; scores[2] += -0.016650; scores[3] += -0.001188; break;
      case 5: scores[0] += -0.000151; scores[1] += 0.000673; scores[2] += -0.000874; scores[3] += 0.000352; break;
      case 6: scores[0] += -0.000026; scores[1] += 0.016686; scores[2] += -0.000318; scores[3] += -0.016342; break;
      case 7: scores[0] += -0.000000; scores[1] += 0.002234; scores[2] += -0.000001; scores[3] += -0.002233; break;
    }
  }

  // Tree 464 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[13] > 0.48331478238105774) << 1) | ((features[27] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000215; scores[1] += -0.011063; scores[2] += 0.003053; scores[3] += 0.007794; break;
      case 1: scores[0] += -0.001292; scores[1] += 0.012147; scores[2] += -0.009171; scores[3] += -0.001684; break;
      case 2: scores[0] += -0.000041; scores[1] += 0.016422; scores[2] += -0.000087; scores[3] += -0.016295; break;
      case 3: scores[0] += -0.001082; scores[1] += -0.006336; scores[2] += -0.000500; scores[3] += 0.007918; break;
      case 4: scores[0] += -0.000030; scores[1] += -0.001206; scores[2] += 0.018042; scores[3] += -0.016806; break;
      case 5: scores[0] += -0.000439; scores[1] += -0.012278; scores[2] += 0.017199; scores[3] += -0.004483; break;
      case 6: scores[0] += -0.000002; scores[1] += -0.004959; scores[2] += -0.000006; scores[3] += 0.004968; break;
      case 7: scores[0] += -0.000030; scores[1] += -0.003857; scores[2] += -0.000018; scores[3] += 0.003906; break;
    }
  }

  // Tree 465 (depth=3)
  {
    const leafIdx = ((features[14] > 0.5) << 0) | ((features[11] > 0.20416666567325592) << 1) | ((features[13] > 0.29814815521240234) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003058; scores[1] += 0.009547; scores[2] += -0.002658; scores[3] += -0.003831; break;
      case 1: scores[0] += -0.001048; scores[1] += 0.002647; scores[2] += -0.000380; scores[3] += -0.001220; break;
      case 2: scores[0] += 0.003638; scores[1] += -0.005672; scores[2] += -0.008697; scores[3] += 0.010731; break;
      case 3: scores[0] += -0.000005; scores[1] += 0.013905; scores[2] += -0.000004; scores[3] += -0.013896; break;
      case 4: scores[0] += -0.000586; scores[1] += -0.040051; scores[2] += -0.000505; scores[3] += 0.041141; break;
      case 5: scores[0] += -0.001369; scores[1] += 0.006249; scores[2] += -0.000472; scores[3] += -0.004408; break;
      case 6: scores[0] += -0.000276; scores[1] += -0.000107; scores[2] += -0.000017; scores[3] += 0.000400; break;
      case 7: scores[0] += -0.000015; scores[1] += -0.000882; scores[2] += -0.000002; scores[3] += 0.000899; break;
    }
  }

  // Tree 466 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[33] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.023989; scores[1] += -0.002175; scores[2] += -0.015231; scores[3] += -0.006583; break;
      case 1: scores[0] += 0.001307; scores[1] += 0.000008; scores[2] += -0.000101; scores[3] += -0.001213; break;
      case 2: scores[0] += -0.026801; scores[1] += 0.001761; scores[2] += 0.013420; scores[3] += 0.011620; break;
      case 3: scores[0] += -0.001312; scores[1] += 0.016167; scores[2] += -0.002606; scores[3] += -0.012249; break;
      case 4: scores[0] += -0.007567; scores[1] += 0.035430; scores[2] += -0.000966; scores[3] += -0.026897; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.009013; scores[1] += 0.009327; scores[2] += -0.011468; scores[3] += 0.011153; break;
      case 7: scores[0] += -0.000004; scores[1] += 0.005082; scores[2] += -0.000001; scores[3] += -0.005078; break;
    }
  }

  // Tree 467 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[43] > 0.28285714983940125) << 1) | ((features[30] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.002809; scores[1] += -0.009087; scores[2] += 0.008734; scores[3] += 0.003162; break;
      case 1: scores[0] += 0.001380; scores[1] += 0.009007; scores[2] += -0.015995; scores[3] += 0.005609; break;
      case 2: scores[0] += -0.000263; scores[1] += 0.000179; scores[2] += -0.000089; scores[3] += 0.000173; break;
      case 3: scores[0] += -0.000007; scores[1] += 0.018910; scores[2] += -0.000009; scores[3] += -0.018895; break;
      case 4: scores[0] += 0.001897; scores[1] += 0.024447; scores[2] += -0.026084; scores[3] += -0.000261; break;
      case 5: scores[0] += -0.000391; scores[1] += 0.016350; scores[2] += -0.000074; scores[3] += -0.015884; break;
      case 6: scores[0] += -0.000196; scores[1] += -0.026493; scores[2] += -0.000078; scores[3] += 0.026767; break;
      case 7: scores[0] += -0.000001; scores[1] += -0.005832; scores[2] += -0.000000; scores[3] += 0.005833; break;
    }
  }

  // Tree 468 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[8] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004102; scores[1] += 0.002439; scores[2] += -0.000062; scores[3] += 0.001725; break;
      case 1: scores[0] += 0.004276; scores[1] += -0.000379; scores[2] += -0.000074; scores[3] += -0.003822; break;
      case 2: scores[0] += 0.000723; scores[1] += -0.000011; scores[2] += -0.000008; scores[3] += -0.000704; break;
      case 3: scores[0] += 0.002047; scores[1] += -0.000025; scores[2] += -0.000078; scores[3] += -0.001944; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000942; scores[1] += -0.000013; scores[2] += -0.000009; scores[3] += -0.000919; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.001258; scores[1] += -0.000020; scores[2] += -0.000068; scores[3] += -0.001169; break;
    }
  }

  // Tree 469 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000382; scores[1] += -0.005447; scores[2] += 0.005993; scores[3] += -0.000164; break;
      case 1: scores[0] += 0.001253; scores[1] += 0.007897; scores[2] += -0.015453; scores[3] += 0.006303; break;
      case 2: scores[0] += -0.001718; scores[1] += 0.009790; scores[2] += -0.015802; scores[3] += 0.007730; break;
      case 3: scores[0] += -0.000024; scores[1] += 0.014768; scores[2] += -0.000309; scores[3] += -0.014434; break;
      case 4: scores[0] += -0.001293; scores[1] += 0.008072; scores[2] += -0.000195; scores[3] += -0.006583; break;
      case 5: scores[0] += -0.000007; scores[1] += 0.013512; scores[2] += -0.000004; scores[3] += -0.013501; break;
      case 6: scores[0] += -0.000021; scores[1] += -0.008685; scores[2] += -0.000009; scores[3] += 0.008715; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.004087; scores[2] += -0.000003; scores[3] += -0.004084; break;
    }
  }

  // Tree 470 (depth=3)
  {
    const leafIdx = ((features[34] > 0.550000011920929) << 0) | ((features[13] > 0.010204081423580647) << 1) | ((features[44] > 0.15000000596046448) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.030180; scores[1] += -0.006066; scores[2] += -0.002437; scores[3] += -0.021676; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += -0.003450; scores[1] += -0.005106; scores[2] += -0.000287; scores[3] += 0.008843; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.037134; scores[1] += 0.012470; scores[2] += 0.010995; scores[3] += 0.013669; break;
      case 5: scores[0] += -0.000025; scores[1] += -0.000155; scores[2] += 0.010438; scores[3] += -0.010258; break;
      case 6: scores[0] += -0.001702; scores[1] += 0.009028; scores[2] += -0.013291; scores[3] += 0.005965; break;
      case 7: scores[0] += -0.000007; scores[1] += -0.000053; scores[2] += -0.000473; scores[3] += 0.000533; break;
    }
  }

  // Tree 471 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003449; scores[1] += -0.014231; scores[2] += 0.007913; scores[3] += 0.002870; break;
      case 1: scores[0] += -0.001335; scores[1] += -0.012119; scores[2] += -0.001889; scores[3] += 0.015343; break;
      case 2: scores[0] += -0.001896; scores[1] += 0.052546; scores[2] += -0.027550; scores[3] += -0.023100; break;
      case 3: scores[0] += -0.000059; scores[1] += 0.015416; scores[2] += -0.000060; scores[3] += -0.015297; break;
      case 4: scores[0] += -0.004858; scores[1] += 0.011701; scores[2] += -0.012722; scores[3] += 0.005879; break;
      case 5: scores[0] += -0.000052; scores[1] += 0.016788; scores[2] += -0.000028; scores[3] += -0.016708; break;
      case 6: scores[0] += -0.000150; scores[1] += -0.021017; scores[2] += -0.000980; scores[3] += 0.022147; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.003964; scores[2] += -0.000001; scores[3] += -0.003960; break;
    }
  }

  // Tree 472 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[10] > 5.550000190734863) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001479; scores[1] += -0.006964; scores[2] += 0.021943; scores[3] += -0.013500; break;
      case 1: scores[0] += -0.000315; scores[1] += 0.010414; scores[2] += -0.001645; scores[3] += -0.008454; break;
      case 2: scores[0] += -0.000149; scores[1] += -0.013957; scores[2] += -0.004198; scores[3] += 0.018303; break;
      case 3: scores[0] += -0.000022; scores[1] += 0.011300; scores[2] += -0.000298; scores[3] += -0.010980; break;
      case 4: scores[0] += -0.000424; scores[1] += -0.003327; scores[2] += 0.002335; scores[3] += 0.001416; break;
      case 5: scores[0] += 0.001327; scores[1] += 0.008731; scores[2] += -0.014409; scores[3] += 0.004350; break;
      case 6: scores[0] += -0.001741; scores[1] += 0.034479; scores[2] += -0.019321; scores[3] += -0.013417; break;
      case 7: scores[0] += -0.000001; scores[1] += 0.007684; scores[2] += -0.000003; scores[3] += -0.007679; break;
    }
  }

  // Tree 473 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[45] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000121; scores[1] += -0.005287; scores[2] += 0.004831; scores[3] += 0.000335; break;
      case 1: scores[0] += 0.000863; scores[1] += 0.016768; scores[2] += -0.015877; scores[3] += -0.001754; break;
      case 2: scores[0] += -0.000929; scores[1] += 0.012886; scores[2] += -0.014472; scores[3] += 0.002515; break;
      case 3: scores[0] += -0.000023; scores[1] += 0.017442; scores[2] += -0.000285; scores[3] += -0.017134; break;
      case 4: scores[0] += -0.002877; scores[1] += 0.006285; scores[2] += 0.003385; scores[3] += -0.006793; break;
      case 5: scores[0] += -0.000318; scores[1] += -0.000812; scores[2] += -0.000405; scores[3] += 0.001535; break;
      case 6: scores[0] += -0.000729; scores[1] += -0.003402; scores[2] += -0.005011; scores[3] += 0.009142; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.000520; scores[2] += -0.000032; scores[3] += -0.000486; break;
    }
  }

  // Tree 474 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[3] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000865; scores[1] += -0.003393; scores[2] += 0.004681; scores[3] += -0.000423; break;
      case 1: scores[0] += -0.001296; scores[1] += 0.001974; scores[2] += -0.001311; scores[3] += 0.000633; break;
      case 2: scores[0] += -0.001533; scores[1] += 0.006076; scores[2] += -0.013320; scores[3] += 0.008776; break;
      case 3: scores[0] += -0.000059; scores[1] += 0.015504; scores[2] += -0.000057; scores[3] += -0.015388; break;
      case 4: scores[0] += 0.000749; scores[1] += 0.015293; scores[2] += -0.015257; scores[3] += -0.000786; break;
      case 5: scores[0] += -0.000134; scores[1] += 0.000440; scores[2] += -0.000789; scores[3] += 0.000482; break;
      case 6: scores[0] += -0.000024; scores[1] += 0.016188; scores[2] += -0.000312; scores[3] += -0.015853; break;
      case 7: scores[0] += -0.000000; scores[1] += 0.001988; scores[2] += -0.000001; scores[3] += -0.001987; break;
    }
  }

  // Tree 475 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[25] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.006232; scores[1] += 0.002666; scores[2] += -0.008075; scores[3] += -0.000823; break;
      case 1: scores[0] += 0.001833; scores[1] += -0.003098; scores[2] += -0.020453; scores[3] += 0.021718; break;
      case 2: scores[0] += -0.003302; scores[1] += -0.006868; scores[2] += 0.015964; scores[3] += -0.005794; break;
      case 3: scores[0] += -0.001278; scores[1] += -0.000053; scores[2] += -0.016743; scores[3] += 0.018075; break;
      case 4: scores[0] += -0.003418; scores[1] += 0.002400; scores[2] += -0.001429; scores[3] += 0.002447; break;
      case 5: scores[0] += -0.001271; scores[1] += -0.006424; scores[2] += -0.000131; scores[3] += 0.007825; break;
      case 6: scores[0] += -0.000425; scores[1] += 0.012637; scores[2] += -0.011346; scores[3] += -0.000866; break;
      case 7: scores[0] += -0.000186; scores[1] += 0.006091; scores[2] += -0.002432; scores[3] += -0.003472; break;
    }
  }

  // Tree 476 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.005133; scores[1] += 0.001777; scores[2] += -0.014301; scores[3] += 0.007391; break;
      case 1: scores[0] += -0.000067; scores[1] += 0.018495; scores[2] += -0.002720; scores[3] += -0.015709; break;
      case 2: scores[0] += -0.004127; scores[1] += 0.013645; scores[2] += 0.001817; scores[3] += -0.011335; break;
      case 3: scores[0] += -0.000000; scores[1] += 0.000034; scores[2] += -0.000001; scores[3] += -0.000032; break;
      case 4: scores[0] += -0.000500; scores[1] += 0.012575; scores[2] += -0.002184; scores[3] += -0.009891; break;
      case 5: scores[0] += -0.000006; scores[1] += 0.001002; scores[2] += -0.000005; scores[3] += -0.000992; break;
      case 6: scores[0] += -0.001089; scores[1] += -0.004994; scores[2] += -0.009609; scores[3] += 0.015693; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 477 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[10] > 5.816666603088379) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005061; scores[1] += -0.009592; scores[2] += 0.013916; scores[3] += 0.000736; break;
      case 1: scores[0] += 0.004122; scores[1] += -0.000362; scores[2] += -0.000075; scores[3] += -0.003685; break;
      case 2: scores[0] += -0.002215; scores[1] += 0.007120; scores[2] += -0.005404; scores[3] += 0.000499; break;
      case 3: scores[0] += 0.003871; scores[1] += -0.000053; scores[2] += -0.000146; scores[3] += -0.003672; break;
      case 4: scores[0] += -0.000006; scores[1] += 0.004734; scores[2] += -0.000076; scores[3] += -0.004653; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000001; scores[1] += 0.001393; scores[2] += -0.000025; scores[3] += -0.001367; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 478 (depth=3)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[5] > 0.5) << 1) | ((features[24] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003633; scores[1] += 0.002658; scores[2] += -0.000709; scores[3] += 0.001684; break;
      case 1: scores[0] += 0.004906; scores[1] += -0.000373; scores[2] += -0.000084; scores[3] += -0.004449; break;
      case 2: scores[0] += 0.000689; scores[1] += -0.000010; scores[2] += -0.000008; scores[3] += -0.000671; break;
      case 3: scores[0] += 0.003049; scores[1] += -0.000041; scores[2] += -0.000138; scores[3] += -0.002870; break;
      case 4: scores[0] += -0.000007; scores[1] += 0.005877; scores[2] += -0.000099; scores[3] += -0.005771; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 479 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[11] > 0.011627906933426857) << 1) | ((features[9] > 4.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003815; scores[1] += 0.004033; scores[2] += -0.010874; scores[3] += 0.003027; break;
      case 1: scores[0] += -0.000027; scores[1] += 0.016697; scores[2] += -0.002657; scores[3] += -0.014013; break;
      case 2: scores[0] += 0.001099; scores[1] += -0.020923; scores[2] += 0.011647; scores[3] += 0.008177; break;
      case 3: scores[0] += -0.000007; scores[1] += 0.002283; scores[2] += -0.000044; scores[3] += -0.002232; break;
      case 4: scores[0] += -0.000109; scores[1] += 0.009601; scores[2] += -0.000173; scores[3] += -0.009318; break;
      case 5: scores[0] += -0.000006; scores[1] += 0.000997; scores[2] += -0.000005; scores[3] += -0.000987; break;
      case 6: scores[0] += -0.001426; scores[1] += 0.001377; scores[2] += -0.011322; scores[3] += 0.011371; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 480 (depth=3)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[13] > 0.4749373495578766) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.023717; scores[1] += -0.017703; scores[2] += -0.002563; scores[3] += -0.003451; break;
      case 1: scores[0] += 0.019831; scores[1] += -0.000202; scores[2] += -0.000032; scores[3] += -0.019597; break;
      case 2: scores[0] += -0.032662; scores[1] += 0.016139; scores[2] += 0.013752; scores[3] += 0.002771; break;
      case 3: scores[0] += -0.012161; scores[1] += 0.019680; scores[2] += -0.034996; scores[3] += 0.027478; break;
      case 4: scores[0] += -0.000838; scores[1] += 0.007684; scores[2] += -0.000077; scores[3] += -0.006769; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000381; scores[1] += -0.007711; scores[2] += -0.000492; scores[3] += 0.008584; break;
      case 7: scores[0] += -0.000019; scores[1] += -0.006949; scores[2] += -0.000021; scores[3] += 0.006989; break;
    }
  }

  // Tree 481 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.07362240552902222) << 1) | ((features[13] > 0.010204081423580647) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005303; scores[1] += -0.001147; scores[2] += 0.009538; scores[3] += -0.003088; break;
      case 1: scores[0] += -0.000832; scores[1] += -0.000082; scores[2] += -0.017583; scores[3] += 0.018498; break;
      case 2: scores[0] += 0.008072; scores[1] += -0.002096; scores[2] += -0.004449; scores[3] += -0.001527; break;
      case 3: scores[0] += -0.000331; scores[1] += -0.000211; scores[2] += 0.019962; scores[3] += -0.019420; break;
      case 4: scores[0] += -0.001630; scores[1] += 0.003070; scores[2] += -0.001604; scores[3] += 0.000163; break;
      case 5: scores[0] += -0.000055; scores[1] += -0.017747; scores[2] += -0.000609; scores[3] += 0.018411; break;
      case 6: scores[0] += -0.003481; scores[1] += 0.009881; scores[2] += -0.010476; scores[3] += 0.004077; break;
      case 7: scores[0] += -0.000045; scores[1] += -0.001601; scores[2] += -0.001996; scores[3] += 0.003642; break;
    }
  }

  // Tree 482 (depth=3)
  {
    const leafIdx = ((features[24] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[11] > 0.20942983031272888) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.003579; scores[1] += 0.004864; scores[2] += -0.014493; scores[3] += 0.006050; break;
      case 1: scores[0] += -0.000007; scores[1] += 0.005805; scores[2] += -0.000096; scores[3] += -0.005703; break;
      case 2: scores[0] += -0.004881; scores[1] += 0.005905; scores[2] += 0.002439; scores[3] += -0.003463; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += 0.002457; scores[1] += 0.000992; scores[2] += -0.003258; scores[3] += -0.000192; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += -0.000000; scores[1] += 0.006120; scores[2] += -0.000003; scores[3] += -0.006118; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 483 (depth=3)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[10] > 3.9000000953674316) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000009; scores[1] += 0.004659; scores[2] += -0.000265; scores[3] += -0.004385; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 2: scores[0] += 0.004943; scores[1] += 0.000555; scores[2] += -0.005639; scores[3] += 0.000141; break;
      case 3: scores[0] += 0.002183; scores[1] += -0.004776; scores[2] += -0.019251; scores[3] += 0.021843; break;
      case 4: scores[0] += -0.000000; scores[1] += 0.001884; scores[2] += -0.000003; scores[3] += -0.001880; break;
      case 5: scores[0] += -0.000000; scores[1] += 0.003977; scores[2] += -0.000002; scores[3] += -0.003974; break;
      case 6: scores[0] += -0.003600; scores[1] += 0.002537; scores[2] += 0.009421; scores[3] += -0.008358; break;
      case 7: scores[0] += -0.001378; scores[1] += 0.003222; scores[2] += -0.018017; scores[3] += 0.016173; break;
    }
  }

  // Tree 484 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[9] > 3.5) << 1) | ((features[14] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001007; scores[1] += -0.010186; scores[2] += 0.014818; scores[3] += -0.003625; break;
      case 1: scores[0] += 0.013782; scores[1] += -0.035079; scores[2] += 0.006152; scores[3] += 0.015144; break;
      case 2: scores[0] += -0.000831; scores[1] += 0.001463; scores[2] += 0.001452; scores[3] += -0.002084; break;
      case 3: scores[0] += -0.009791; scores[1] += 0.025384; scores[2] += -0.009471; scores[3] += -0.006122; break;
      case 4: scores[0] += -0.000039; scores[1] += 0.016167; scores[2] += -0.000082; scores[3] += -0.016046; break;
      case 5: scores[0] += -0.002349; scores[1] += 0.015564; scores[2] += -0.000517; scores[3] += -0.012697; break;
      case 6: scores[0] += -0.000016; scores[1] += -0.022862; scores[2] += -0.000074; scores[3] += 0.022951; break;
      case 7: scores[0] += -0.000086; scores[1] += -0.008717; scores[2] += -0.000125; scores[3] += 0.008929; break;
    }
  }

  // Tree 485 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.0635080635547638) << 1) | ((features[11] > 0.07362240552902222) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.004508; scores[1] += 0.001324; scores[2] += 0.005188; scores[3] += -0.002004; break;
      case 1: scores[0] += -0.000553; scores[1] += -0.016420; scores[2] += -0.005117; scores[3] += 0.022090; break;
      case 2: scores[0] += -0.001671; scores[1] += -0.014317; scores[2] += 0.013131; scores[3] += 0.002857; break;
      case 3: scores[0] += -0.000291; scores[1] += -0.000100; scores[2] += -0.018185; scores[3] += 0.018575; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.005195; scores[1] += 0.005043; scores[2] += -0.007718; scores[3] += -0.002520; break;
      case 7: scores[0] += -0.000375; scores[1] += -0.002067; scores[2] += 0.017748; scores[3] += -0.015306; break;
    }
  }

  // Tree 486 (depth=3)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[13] > 0.024695120751857758) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004014; scores[1] += -0.012955; scores[2] += 0.006763; scores[3] += 0.002178; break;
      case 1: scores[0] += -0.001242; scores[1] += -0.012410; scores[2] += -0.001751; scores[3] += 0.015402; break;
      case 2: scores[0] += -0.001793; scores[1] += 0.048420; scores[2] += -0.025344; scores[3] += -0.021283; break;
      case 3: scores[0] += -0.000053; scores[1] += 0.013831; scores[2] += -0.000054; scores[3] += -0.013724; break;
      case 4: scores[0] += -0.004702; scores[1] += 0.011146; scores[2] += -0.012566; scores[3] += 0.006122; break;
      case 5: scores[0] += -0.000049; scores[1] += 0.016292; scores[2] += -0.000026; scores[3] += -0.016217; break;
      case 6: scores[0] += -0.000122; scores[1] += -0.020820; scores[2] += -0.000752; scores[3] += 0.021695; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.003757; scores[2] += -0.000001; scores[3] += -0.003754; break;
    }
  }

  // Tree 487 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[16] > 0.5) << 1) | ((features[9] > 3.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001679; scores[1] += 0.003796; scores[2] += 0.008944; scores[3] += -0.011061; break;
      case 1: scores[0] += 0.004177; scores[1] += 0.000559; scores[2] += -0.004412; scores[3] += -0.000324; break;
      case 2: scores[0] += -0.000021; scores[1] += -0.000038; scores[2] += 0.006058; scores[3] += -0.005999; break;
      case 3: scores[0] += -0.000077; scores[1] += -0.002753; scores[2] += -0.000307; scores[3] += 0.003138; break;
      case 4: scores[0] += -0.000777; scores[1] += -0.008668; scores[2] += 0.000726; scores[3] += 0.008718; break;
      case 5: scores[0] += -0.009369; scores[1] += 0.013323; scores[2] += -0.004151; scores[3] += 0.000198; break;
      case 6: scores[0] += -0.000014; scores[1] += -0.003076; scores[2] += 0.003784; scores[3] += -0.000694; break;
      case 7: scores[0] += -0.000006; scores[1] += -0.000047; scores[2] += 0.000287; scores[3] += -0.000234; break;
    }
  }

  // Tree 488 (depth=3)
  {
    const leafIdx = ((features[13] > 0.15192309021949768) << 0) | ((features[10] > 6.449999809265137) << 1) | ((features[4] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005982; scores[1] += 0.013872; scores[2] += 0.007158; scores[3] += -0.015048; break;
      case 1: scores[0] += -0.000078; scores[1] += -0.009736; scores[2] += -0.000519; scores[3] += 0.010334; break;
      case 2: scores[0] += -0.032369; scores[1] += 0.008680; scores[2] += 0.007442; scores[3] += 0.016247; break;
      case 3: scores[0] += -0.000752; scores[1] += 0.002848; scores[2] += -0.001150; scores[3] += -0.000947; break;
      case 4: scores[0] += -0.012592; scores[1] += -0.004249; scores[2] += -0.000896; scores[3] += 0.017737; break;
      case 5: scores[0] += -0.000026; scores[1] += -0.004672; scores[2] += -0.000027; scores[3] += 0.004725; break;
      case 6: scores[0] += 0.040258; scores[1] += -0.000102; scores[2] += -0.001125; scores[3] += -0.039030; break;
      case 7: scores[0] += -0.003178; scores[1] += -0.005030; scores[2] += -0.000280; scores[3] += 0.008489; break;
    }
  }

  // Tree 489 (depth=3)
  {
    const leafIdx = ((features[43] > 0.23669467866420746) << 0) | ((features[13] > 0.35388994216918945) << 1) | ((features[13] > 0.3291666507720947) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.003230; scores[1] += 0.013351; scores[2] += -0.005140; scores[3] += -0.004981; break;
      case 1: scores[0] += -0.000244; scores[1] += -0.012572; scores[2] += -0.000120; scores[3] += 0.012936; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.000287; scores[1] += 0.008355; scores[2] += -0.000038; scores[3] += -0.008030; break;
      case 5: scores[0] += -0.000049; scores[1] += -0.026303; scores[2] += -0.000016; scores[3] += 0.026368; break;
      case 6: scores[0] += -0.001217; scores[1] += -0.003892; scores[2] += -0.000891; scores[3] += 0.006000; break;
      case 7: scores[0] += -0.000347; scores[1] += -0.002414; scores[2] += -0.000134; scores[3] += 0.002895; break;
    }
  }

  // Tree 490 (depth=3)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[10] > 14.75) << 1) | ((features[13] > 0.40682870149612427) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.005846; scores[1] += 0.004425; scores[2] += 0.000121; scores[3] += 0.001300; break;
      case 1: scores[0] += -0.000213; scores[1] += 0.004946; scores[2] += -0.000049; scores[3] += -0.004684; break;
      case 2: scores[0] += 0.011481; scores[1] += -0.000339; scores[2] += -0.000554; scores[3] += -0.010589; break;
      case 3: scores[0] += -0.000813; scores[1] += -0.005054; scores[2] += -0.000087; scores[3] += 0.005955; break;
      case 4: scores[0] += -0.000767; scores[1] += -0.006425; scores[2] += -0.000771; scores[3] += 0.007964; break;
      case 5: scores[0] += -0.000034; scores[1] += 0.036434; scores[2] += -0.000013; scores[3] += -0.036387; break;
      case 6: scores[0] += -0.000409; scores[1] += -0.004309; scores[2] += -0.000035; scores[3] += 0.004753; break;
      case 7: scores[0] += -0.000106; scores[1] += -0.014783; scores[2] += -0.000026; scores[3] += 0.014914; break;
    }
  }

  // Tree 491 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.366666793823242) << 1) | ((features[37] > 0.10000000149011612) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.016683; scores[1] += 0.008193; scores[2] += -0.000938; scores[3] += 0.009427; break;
      case 1: scores[0] += -0.000040; scores[1] += -0.000019; scores[2] += 0.011797; scores[3] += -0.011738; break;
      case 2: scores[0] += 0.009577; scores[1] += 0.001663; scores[2] += -0.010251; scores[3] += -0.000988; break;
      case 3: scores[0] += -0.000056; scores[1] += -0.002454; scores[2] += 0.003274; scores[3] += -0.000764; break;
      case 4: scores[0] += -0.000140; scores[1] += -0.005725; scores[2] += 0.015448; scores[3] += -0.009583; break;
      case 5: scores[0] += -0.000015; scores[1] += -0.000656; scores[2] += 0.001420; scores[3] += -0.000749; break;
      case 6: scores[0] += -0.000483; scores[1] += -0.004711; scores[2] += 0.013383; scores[3] += -0.008188; break;
      case 7: scores[0] += -0.000092; scores[1] += -0.001545; scores[2] += 0.004381; scores[3] += -0.002744; break;
    }
  }

  // Tree 492 (depth=3)
  {
    const leafIdx = ((features[10] > 5.816666603088379) << 0) | ((features[23] > 0.5) << 1) | ((features[34] > 0.05000000074505806) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.000696; scores[1] += -0.033191; scores[2] += 0.020632; scores[3] += 0.011863; break;
      case 1: scores[0] += 0.009479; scores[1] += -0.006748; scores[2] += -0.009332; scores[3] += 0.006602; break;
      case 2: scores[0] += -0.000502; scores[1] += 0.027280; scores[2] += 0.001248; scores[3] += -0.028026; break;
      case 3: scores[0] += -0.009477; scores[1] += 0.023855; scores[2] += -0.009679; scores[3] += -0.004699; break;
      case 4: scores[0] += -0.000067; scores[1] += 0.009474; scores[2] += 0.000540; scores[3] += -0.009947; break;
      case 5: scores[0] += -0.003106; scores[1] += 0.011978; scores[2] += -0.002435; scores[3] += -0.006438; break;
      case 6: scores[0] += -0.000127; scores[1] += -0.023670; scores[2] += 0.000706; scores[3] += 0.023090; break;
      case 7: scores[0] += -0.002210; scores[1] += -0.019756; scores[2] += -0.002064; scores[3] += 0.024029; break;
    }
  }

  // Tree 493 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[28] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.001041; scores[1] += -0.003760; scores[2] += 0.005716; scores[3] += -0.000915; break;
      case 1: scores[0] += 0.000616; scores[1] += 0.015290; scores[2] += -0.014992; scores[3] += -0.000915; break;
      case 2: scores[0] += -0.001394; scores[1] += 0.001525; scores[2] += -0.011320; scores[3] += 0.011189; break;
      case 3: scores[0] += -0.000023; scores[1] += 0.015838; scores[2] += -0.000298; scores[3] += -0.015517; break;
      case 4: scores[0] += -0.001138; scores[1] += 0.000669; scores[2] += -0.001183; scores[3] += 0.001651; break;
      case 5: scores[0] += -0.000124; scores[1] += 0.000343; scores[2] += -0.000722; scores[3] += 0.000503; break;
      case 6: scores[0] += -0.000052; scores[1] += 0.014651; scores[2] += -0.000051; scores[3] += -0.014548; break;
      case 7: scores[0] += -0.000000; scores[1] += 0.002106; scores[2] += -0.000001; scores[3] += -0.002105; break;
    }
  }

  // Tree 494 (depth=3)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.08759590983390808) << 1) | ((features[11] > 0.0944940447807312) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.008150; scores[1] += -0.003697; scores[2] += 0.017114; scores[3] += -0.005266; break;
      case 1: scores[0] += -0.000866; scores[1] += -0.016216; scores[2] += -0.004295; scores[3] += 0.021377; break;
      case 2: scores[0] += 0.000973; scores[1] += -0.001967; scores[2] += -0.006831; scores[3] += 0.007824; break;
      case 3: scores[0] += -0.000058; scores[1] += -0.000131; scores[2] += 0.025182; scores[3] += -0.024992; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 6: scores[0] += 0.007889; scores[1] += 0.015194; scores[2] += -0.028521; scores[3] += 0.005438; break;
      case 7: scores[0] += -0.000160; scores[1] += -0.001302; scores[2] += -0.008062; scores[3] += 0.009523; break;
    }
  }

  // Tree 495 (depth=3)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[26] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.000367; scores[1] += -0.005505; scores[2] += 0.005853; scores[3] += 0.000019; break;
      case 1: scores[0] += 0.001076; scores[1] += 0.006445; scores[2] += -0.014060; scores[3] += 0.006539; break;
      case 2: scores[0] += -0.001474; scores[1] += 0.008574; scores[2] += -0.013226; scores[3] += 0.006126; break;
      case 3: scores[0] += -0.000023; scores[1] += 0.013978; scores[2] += -0.000285; scores[3] += -0.013670; break;
      case 4: scores[0] += -0.001257; scores[1] += 0.007757; scores[2] += -0.000173; scores[3] += -0.006326; break;
      case 5: scores[0] += -0.000006; scores[1] += 0.012876; scores[2] += -0.000003; scores[3] += -0.012866; break;
      case 6: scores[0] += -0.000019; scores[1] += -0.007041; scores[2] += -0.000008; scores[3] += 0.007068; break;
      case 7: scores[0] += -0.000000; scores[1] += 0.003943; scores[2] += -0.000002; scores[3] += -0.003941; break;
    }
  }

  // Tree 496 (depth=3)
  {
    const leafIdx = ((features[1] > 0.5) << 0) | ((features[2] > 0.5) << 1) | ((features[34] > 0.25) << 2);
    switch (leafIdx) {
      case 0: scores[0] += 0.004760; scores[1] += -0.000543; scores[2] += -0.004956; scores[3] += 0.000739; break;
      case 1: scores[0] += -0.000023; scores[1] += 0.017896; scores[2] += -0.002632; scores[3] += -0.015241; break;
      case 2: scores[0] += 0.001627; scores[1] += -0.005152; scores[2] += -0.018681; scores[3] += 0.022206; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
      case 4: scores[0] += -0.003397; scores[1] += 0.003469; scores[2] += 0.009244; scores[3] += -0.009316; break;
      case 5: scores[0] += -0.000000; scores[1] += 0.000030; scores[2] += -0.000001; scores[3] += -0.000028; break;
      case 6: scores[0] += -0.001378; scores[1] += 0.006832; scores[2] += -0.016814; scores[3] += 0.011361; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; scores[3] += 0.000000; break;
    }
  }

  // Tree 497 (depth=3)
  {
    const leafIdx = ((features[17] > 0.5) << 0) | ((features[10] > 6.633333206176758) << 1) | ((features[20] > 0.5) << 2);
    switch (leafIdx) {
      case 0: scores[0] += -0.017154; scores[1] += 0.001395; scores[2] += 0.009179; scores[3] += 0.006580; break;
      case 1: scores[0] += -0.000040; scores[1] += -0.000018; scores[2] += 0.011676; scores[3] += -0.011618; break;
      case 2: scores[0] += 0.011322; scores[1] += -0.002549; scores[2] += -0.007967; scores[3] += -0.000806; break;
      case 3: scores[0] += -0.000128; scores[1] += -0.003879; scores[2] += 0.006958; scores[3] += -0.002951; break;
      case 4: scores[0] += -0.000786; scores[1] += 0.013923; scores[2] += 0.000094; scores[3] += -0.013231; break;
      case 5: scores[0] += -0.000014; scores[1] += -0.000609; scores[2] += 0.001346; scores[3] += -0.000722; break;
      case 6: scores[0] += -0.002827; scores[1] += -0.001645; scores[2] += -0.002144; scores[3] += 0.006617; break;
      case 7: scores[0] += -0.000016; scores[1] += -0.000104; scores[2] += 0.000159; scores[3] += -0.000039; break;
    }
  }

  // Find winning class
  let maxIdx = 0;
  let maxScore = scores[0];
  for (let i = 1; i < 4; i++) {
    if (scores[i] > maxScore) {
      maxScore = scores[i];
      maxIdx = i;
    }
  }

  // Calculate confidence via softmax
  const expScores = scores.map(s => Math.exp(s));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  const probs = expScores.map(e => e / sumExp);
  const confidence = probs[maxIdx];

  return {
    mode: LABELS[maxIdx],
    confidence,
    scores,
    probs,
  };
}

export { routeQueryCatBoost, LABELS };