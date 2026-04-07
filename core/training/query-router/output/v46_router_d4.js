/**
 * CatBoost Query Router - Auto-generated from trained model
 * Trees: 498
 * Classes: 3 (LEXICAL, SEMANTIC, HYBRID)
 * 
 * This is pure JavaScript - no native dependencies required.
 */

const LABELS = ["LEXICAL", "SEMANTIC", "HYBRID"];

/**
 * Route a query using the CatBoost model.
 * @param {number[]} features - Array of 38 features
 * @returns {{mode: string, confidence: number, scores: number[]}}
 */
function routeQueryCatBoost(features) {
  // Accumulate scores across all trees
  const scores = new Array(3).fill(0);  // LEXICAL, SEMANTIC, HYBRID

  // Tree 0 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[11] > 0.03229166567325592) << 1) | ((features[45] > 0.5) << 2) | ((features[43] > 0.14907407760620117) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.094114; scores[1] += 0.144869; scores[2] += -0.050755; break;
      case 1: scores[0] += 0.110518; scores[1] += -0.024314; scores[2] += -0.086204; break;
      case 2: scores[0] += -0.055828; scores[1] += -0.044473; scores[2] += 0.100302; break;
      case 3: scores[0] += 0.194878; scores[1] += -0.097439; scores[2] += -0.097439; break;
      case 4: scores[0] += -0.094707; scores[1] += 0.189414; scores[2] += -0.094707; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.087647; scores[1] += 0.175294; scores[2] += -0.087647; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.092449; scores[1] += 0.088974; scores[2] += 0.003476; break;
      case 9: scores[0] += -0.041500; scores[1] += 0.121179; scores[2] += -0.079679; break;
      case 10: scores[0] += -0.081106; scores[1] += -0.019826; scores[2] += 0.100932; break;
      case 11: scores[0] += 0.067913; scores[1] += -0.033957; scores[2] += -0.033957; break;
      case 12: scores[0] += -0.080042; scores[1] += 0.160083; scores[2] += -0.080042; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.048065; scores[1] += 0.096130; scores[2] += -0.048065; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 1 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[11] > 0.028991596773266792) << 1) | ((features[20] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.086692; scores[1] += 0.130515; scores[2] += -0.043822; break;
      case 1: scores[0] += 0.030428; scores[1] += 0.052030; scores[2] += -0.082458; break;
      case 2: scores[0] += -0.081479; scores[1] += 0.021024; scores[2] += 0.060456; break;
      case 3: scores[0] += 0.145998; scores[1] += -0.072999; scores[2] += -0.072999; break;
      case 4: scores[0] += -0.080360; scores[1] += 0.160779; scores[2] += -0.080419; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.057226; scores[1] += 0.114452; scores[2] += -0.057226; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.081941; scores[1] += 0.087353; scores[2] += -0.005412; break;
      case 9: scores[0] += 0.016393; scores[1] += 0.055509; scores[2] += -0.071902; break;
      case 10: scores[0] += -0.043979; scores[1] += -0.055058; scores[2] += 0.099037; break;
      case 11: scores[0] += 0.161826; scores[1] += -0.080913; scores[2] += -0.080913; break;
      case 12: scores[0] += -0.072892; scores[1] += 0.145784; scores[2] += -0.072892; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.074428; scores[1] += 0.148855; scores[2] += -0.074428; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 2 (depth=4)
  {
    const leafIdx = ((features[44] > 0.15000000596046448) << 0) | ((features[30] > 0.5) << 1) | ((features[43] > 0.14907407760620117) << 2) | ((features[2] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.099867; scores[1] += -0.025162; scores[2] += -0.074704; break;
      case 1: scores[0] += -0.077712; scores[1] += 0.104317; scores[2] += -0.026606; break;
      case 2: scores[0] += 0.135974; scores[1] += -0.064533; scores[2] += -0.071441; break;
      case 3: scores[0] += -0.050720; scores[1] += 0.098501; scores[2] += -0.047781; break;
      case 4: scores[0] += -0.074167; scores[1] += 0.138274; scores[2] += -0.064108; break;
      case 5: scores[0] += -0.077531; scores[1] += 0.141177; scores[2] += -0.063646; break;
      case 6: scores[0] += -0.016120; scores[1] += 0.030611; scores[2] += -0.014491; break;
      case 7: scores[0] += -0.052374; scores[1] += 0.022089; scores[2] += 0.030285; break;
      case 8: scores[0] += 0.119271; scores[1] += -0.059636; scores[2] += -0.059636; break;
      case 9: scores[0] += -0.047541; scores[1] += -0.010453; scores[2] += 0.057995; break;
      case 10: scores[0] += 0.136396; scores[1] += -0.068198; scores[2] += -0.068198; break;
      case 11: scores[0] += -0.052592; scores[1] += -0.079105; scores[2] += 0.131698; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.035000; scores[1] += 0.056784; scores[2] += -0.021784; break;
      case 14: scores[0] += 0.057922; scores[1] += -0.028961; scores[2] += -0.028961; break;
      case 15: scores[0] += -0.062472; scores[1] += -0.063343; scores[2] += 0.125814; break;
    }
  }

  // Tree 3 (depth=4)
  {
    const leafIdx = ((features[44] > 0.15000000596046448) << 0) | ((features[2] > 0.5) << 1) | ((features[30] > 0.5) << 2) | ((features[43] > 0.20416666567325592) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.083840; scores[1] += -0.012611; scores[2] += -0.071230; break;
      case 1: scores[0] += -0.073152; scores[1] += 0.093809; scores[2] += -0.020657; break;
      case 2: scores[0] += 0.108783; scores[1] += -0.054391; scores[2] += -0.054391; break;
      case 3: scores[0] += -0.046581; scores[1] += -0.002746; scores[2] += 0.049327; break;
      case 4: scores[0] += 0.121806; scores[1] += -0.057115; scores[2] += -0.064691; break;
      case 5: scores[0] += -0.044607; scores[1] += 0.084203; scores[2] += -0.039597; break;
      case 6: scores[0] += 0.123408; scores[1] += -0.061704; scores[2] += -0.061704; break;
      case 7: scores[0] += -0.045971; scores[1] += -0.072242; scores[2] += 0.118213; break;
      case 8: scores[0] += -0.065699; scores[1] += 0.120129; scores[2] += -0.054429; break;
      case 9: scores[0] += -0.067061; scores[1] += 0.127508; scores[2] += -0.060446; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.020529; scores[1] += 0.041966; scores[2] += -0.021436; break;
      case 12: scores[0] += -0.015792; scores[1] += 0.030003; scores[2] += -0.014211; break;
      case 13: scores[0] += -0.049533; scores[1] += 0.020485; scores[2] += 0.029047; break;
      case 14: scores[0] += 0.028402; scores[1] += -0.014201; scores[2] += -0.014201; break;
      case 15: scores[0] += -0.046407; scores[1] += -0.047425; scores[2] += 0.093832; break;
    }
  }

  // Tree 4 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[11] > 0.02565789595246315) << 1) | ((features[35] > 0.5) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.062187; scores[1] += 0.103259; scores[2] += -0.041071; break;
      case 1: scores[0] += 0.025264; scores[1] += 0.049578; scores[2] += -0.074842; break;
      case 2: scores[0] += -0.024564; scores[1] += -0.007920; scores[2] += 0.032484; break;
      case 3: scores[0] += 0.118153; scores[1] += -0.059109; scores[2] += -0.059043; break;
      case 4: scores[0] += -0.069714; scores[1] += 0.103373; scores[2] += -0.033659; break;
      case 5: scores[0] += -0.003235; scores[1] += -0.020212; scores[2] += 0.023447; break;
      case 6: scores[0] += -0.066786; scores[1] += 0.091466; scores[2] += -0.024680; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.085400; scores[1] += 0.026347; scores[2] += 0.059054; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.058994; scores[1] += -0.059669; scores[2] += 0.118663; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.069373; scores[1] += 0.073977; scores[2] += -0.004604; break;
      case 13: scores[0] += 0.015332; scores[1] += -0.008735; scores[2] += -0.006597; break;
      case 14: scores[0] += -0.053308; scores[1] += -0.008275; scores[2] += 0.061583; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 5 (depth=4)
  {
    const leafIdx = ((features[44] > 0.15000000596046448) << 0) | ((features[0] > 0.5) << 1) | ((features[25] > 0.5) << 2) | ((features[26] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.095318; scores[1] += -0.054370; scores[2] += -0.040948; break;
      case 1: scores[0] += -0.068158; scores[1] += 0.100422; scores[2] += -0.032263; break;
      case 2: scores[0] += 0.106400; scores[1] += -0.053220; scores[2] += -0.053181; break;
      case 3: scores[0] += -0.059680; scores[1] += -0.034052; scores[2] += 0.093732; break;
      case 4: scores[0] += 0.087443; scores[1] += -0.019641; scores[2] += -0.067802; break;
      case 5: scores[0] += -0.050076; scores[1] += 0.039029; scores[2] += 0.011047; break;
      case 6: scores[0] += 0.085041; scores[1] += -0.042989; scores[2] += -0.042052; break;
      case 7: scores[0] += -0.037739; scores[1] += -0.008810; scores[2] += 0.046549; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.061897; scores[1] += 0.110381; scores[2] += -0.048484; break;
      case 13: scores[0] += -0.060478; scores[1] += 0.114590; scores[2] += -0.054112; break;
      case 14: scores[0] += 0.047824; scores[1] += -0.023912; scores[2] += -0.023913; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 6 (depth=4)
  {
    const leafIdx = ((features[44] > 0.15000000596046448) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[22] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.049818; scores[1] += 0.019004; scores[2] += -0.068822; break;
      case 1: scores[0] += -0.065624; scores[1] += 0.074579; scores[2] += -0.008955; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.057895; scores[1] += 0.099200; scores[2] += -0.041306; break;
      case 4: scores[0] += 0.014167; scores[1] += -0.008027; scores[2] += -0.006140; break;
      case 5: scores[0] += -0.078074; scores[1] += 0.032716; scores[2] += 0.045358; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.054167; scores[1] += 0.098646; scores[2] += -0.044479; break;
      case 8: scores[0] += 0.099634; scores[1] += -0.045792; scores[2] += -0.053843; break;
      case 9: scores[0] += -0.017757; scores[1] += 0.024441; scores[2] += -0.006684; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.054700; scores[1] += 0.088623; scores[2] += -0.033923; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.059222; scores[1] += -0.057074; scores[2] += 0.116296; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.066973; scores[1] += 0.010435; scores[2] += 0.056538; break;
    }
  }

  // Tree 7 (depth=4)
  {
    const leafIdx = ((features[9] > 1.5) << 0) | ((features[43] > 0.13188406825065613) << 1) | ((features[22] > 0.5) << 2) | ((features[13] > 0.3380952477455139) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.095234; scores[1] += -0.048805; scores[2] += -0.046429; break;
      case 1: scores[0] += -0.065063; scores[1] += 0.077871; scores[2] += -0.012808; break;
      case 2: scores[0] += -0.032915; scores[1] += 0.074366; scores[2] += -0.041451; break;
      case 3: scores[0] += -0.069282; scores[1] += 0.069739; scores[2] += -0.000457; break;
      case 4: scores[0] += 0.014018; scores[1] += -0.007937; scores[2] += -0.006081; break;
      case 5: scores[0] += -0.074625; scores[1] += 0.054764; scores[2] += 0.019861; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.060937; scores[1] += -0.040538; scores[2] += 0.101475; break;
      case 8: scores[0] += 0.077406; scores[1] += -0.014473; scores[2] += -0.062933; break;
      case 9: scores[0] += -0.013142; scores[1] += 0.031376; scores[2] += -0.018234; break;
      case 10: scores[0] += -0.001397; scores[1] += 0.061768; scores[2] += -0.060371; break;
      case 11: scores[0] += -0.055864; scores[1] += 0.062948; scores[2] += -0.007085; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.058774; scores[1] += -0.038676; scores[2] += 0.097449; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.062332; scores[1] += -0.040416; scores[2] += 0.102748; break;
    }
  }

  // Tree 8 (depth=4)
  {
    const leafIdx = ((features[11] > 0.028991596773266792) << 0) | ((features[10] > 10.291666030883789) << 1) | ((features[45] > 0.5) << 2) | ((features[44] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.036903; scores[1] += 0.005822; scores[2] += -0.042725; break;
      case 1: scores[0] += 0.073259; scores[1] += -0.037076; scores[2] += -0.036183; break;
      case 2: scores[0] += 0.014911; scores[1] += 0.056395; scores[2] += -0.071306; break;
      case 3: scores[0] += 0.094161; scores[1] += -0.047253; scores[2] += -0.046907; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.053288; scores[1] += 0.056513; scores[2] += -0.003225; break;
      case 9: scores[0] += -0.037436; scores[1] += -0.018077; scores[2] += 0.055513; break;
      case 10: scores[0] += -0.056026; scores[1] += 0.079505; scores[2] += -0.023480; break;
      case 11: scores[0] += -0.003818; scores[1] += -0.055612; scores[2] += 0.059430; break;
      case 12: scores[0] += -0.048767; scores[1] += 0.098729; scores[2] += -0.049963; break;
      case 13: scores[0] += -0.047931; scores[1] += 0.098775; scores[2] += -0.050844; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.017570; scores[1] += 0.038670; scores[2] += -0.021100; break;
    }
  }

  // Tree 9 (depth=4)
  {
    const leafIdx = ((features[11] > 0.02565789595246315) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[23] > 0.5) << 2) | ((features[13] > 0.4027026891708374) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004927; scores[1] += 0.036230; scores[2] += -0.041157; break;
      case 1: scores[0] += 0.089202; scores[1] += -0.044748; scores[2] += -0.044454; break;
      case 2: scores[0] += -0.065465; scores[1] += 0.068953; scores[2] += -0.003487; break;
      case 3: scores[0] += -0.057594; scores[1] += -0.017640; scores[2] += 0.075234; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.047778; scores[1] += 0.096812; scores[2] += -0.049034; break;
      case 7: scores[0] += -0.046585; scores[1] += 0.089536; scores[2] += -0.042951; break;
      case 8: scores[0] += 0.036106; scores[1] += 0.032061; scores[2] += -0.068168; break;
      case 9: scores[0] += 0.085509; scores[1] += -0.043255; scores[2] += -0.042254; break;
      case 10: scores[0] += -0.032789; scores[1] += 0.020428; scores[2] += 0.012361; break;
      case 11: scores[0] += 0.021580; scores[1] += -0.041414; scores[2] += 0.019834; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.038110; scores[1] += 0.079345; scores[2] += -0.041235; break;
      case 15: scores[0] += -0.036851; scores[1] += 0.077649; scores[2] += -0.040799; break;
    }
  }

  // Tree 10 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[11] > 0.03077651560306549) << 2) | ((features[45] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.061870; scores[1] += 0.053733; scores[2] += 0.008136; break;
      case 1: scores[0] += 0.025818; scores[1] += 0.035828; scores[2] += -0.061646; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.016019; scores[1] += -0.005802; scores[2] += 0.021822; break;
      case 5: scores[0] += 0.084005; scores[1] += -0.042418; scores[2] += -0.041587; break;
      case 6: scores[0] += -0.025759; scores[1] += -0.048777; scores[2] += 0.074536; break;
      case 7: scores[0] += 0.085086; scores[1] += -0.042671; scores[2] += -0.042415; break;
      case 8: scores[0] += -0.044189; scores[1] += 0.089620; scores[2] += -0.045430; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.038454; scores[1] += 0.080375; scores[2] += -0.041921; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.037818; scores[1] += 0.080347; scores[2] += -0.042529; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 11 (depth=4)
  {
    const leafIdx = ((features[44] > 0.15000000596046448) << 0) | ((features[11] > 0.048199765384197235) << 1) | ((features[9] > 3.5) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.042674; scores[1] += 0.004005; scores[2] += -0.046679; break;
      case 1: scores[0] += -0.061491; scores[1] += 0.038384; scores[2] += 0.023107; break;
      case 2: scores[0] += 0.082953; scores[1] += -0.041643; scores[2] += -0.041310; break;
      case 3: scores[0] += -0.043932; scores[1] += -0.012104; scores[2] += 0.056036; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.042039; scores[1] += 0.085889; scores[2] += -0.043850; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.061075; scores[1] += 0.017693; scores[2] += 0.043382; break;
      case 8: scores[0] += 0.000933; scores[1] += 0.053434; scores[2] += -0.054367; break;
      case 9: scores[0] += -0.045556; scores[1] += 0.030907; scores[2] += 0.014650; break;
      case 10: scores[0] += 0.078683; scores[1] += -0.039812; scores[2] += -0.038871; break;
      case 11: scores[0] += 0.028506; scores[1] += -0.039846; scores[2] += 0.011340; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.039090; scores[1] += 0.077527; scores[2] += -0.038437; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.033579; scores[1] += 0.059699; scores[2] += -0.026120; break;
    }
  }

  // Tree 12 (depth=4)
  {
    const leafIdx = ((features[11] > 0.04653679579496384) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[26] > 0.5) << 2) | ((features[9] > 3.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.050117; scores[1] += -0.000334; scores[2] += -0.049783; break;
      case 1: scores[0] += 0.081583; scores[1] += -0.040947; scores[2] += -0.040636; break;
      case 2: scores[0] += -0.050217; scores[1] += 0.026476; scores[2] += 0.023741; break;
      case 3: scores[0] += -0.000791; scores[1] += -0.032045; scores[2] += 0.032836; break;
      case 4: scores[0] += -0.054246; scores[1] += 0.085037; scores[2] += -0.030791; break;
      case 5: scores[0] += 0.033205; scores[1] += -0.017412; scores[2] += -0.015793; break;
      case 6: scores[0] += -0.044925; scores[1] += 0.081359; scores[2] += -0.036434; break;
      case 7: scores[0] += -0.026409; scores[1] += 0.069807; scores[2] += -0.043398; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.039917; scores[1] += 0.079692; scores[2] += -0.039774; break;
      case 11: scores[0] += -0.052642; scores[1] += 0.032916; scores[2] += 0.019726; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.020099; scores[1] += 0.047982; scores[2] += -0.027883; break;
      case 15: scores[0] += -0.010861; scores[1] += 0.029081; scores[2] += -0.018220; break;
    }
  }

  // Tree 13 (depth=4)
  {
    const leafIdx = ((features[9] > 1.5) << 0) | ((features[11] > 0.03229166567325592) << 1) | ((features[26] > 0.5) << 2) | ((features[9] > 3.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.045801; scores[1] += 0.013179; scores[2] += -0.058980; break;
      case 1: scores[0] += -0.064642; scores[1] += 0.031245; scores[2] += 0.033397; break;
      case 2: scores[0] += 0.079443; scores[1] += -0.039881; scores[2] += -0.039562; break;
      case 3: scores[0] += -0.006649; scores[1] += -0.028686; scores[2] += 0.035335; break;
      case 4: scores[0] += -0.051607; scores[1] += 0.081707; scores[2] += -0.030099; break;
      case 5: scores[0] += -0.042607; scores[1] += 0.076338; scores[2] += -0.033731; break;
      case 6: scores[0] += 0.032292; scores[1] += -0.016928; scores[2] += -0.015364; break;
      case 7: scores[0] += -0.025101; scores[1] += 0.066226; scores[2] += -0.041125; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += -0.038086; scores[1] += 0.075867; scores[2] += -0.037782; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.050635; scores[1] += 0.031630; scores[2] += 0.019005; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.019388; scores[1] += 0.046287; scores[2] += -0.026899; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.010677; scores[1] += 0.028500; scores[2] += -0.017824; break;
    }
  }

  // Tree 14 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[22] > 0.5) << 1) | ((features[14] > 0.5) << 2) | ((features[13] > 0.1889880895614624) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.011838; scores[1] += 0.003314; scores[2] += -0.015151; break;
      case 1: scores[0] += -0.042072; scores[1] += 0.084722; scores[2] += -0.042650; break;
      case 2: scores[0] += -0.065804; scores[1] += 0.032918; scores[2] += 0.032887; break;
      case 3: scores[0] += -0.033347; scores[1] += 0.072897; scores[2] += -0.039549; break;
      case 4: scores[0] += -0.036335; scores[1] += 0.062018; scores[2] += -0.025683; break;
      case 5: scores[0] += -0.014285; scores[1] += 0.034028; scores[2] += -0.019743; break;
      case 6: scores[0] += -0.025884; scores[1] += 0.014277; scores[2] += 0.011607; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.019482; scores[1] += -0.032862; scores[2] += 0.013379; break;
      case 9: scores[0] += -0.026183; scores[1] += 0.057417; scores[2] += -0.031233; break;
      case 10: scores[0] += -0.058077; scores[1] += -0.051514; scores[2] += 0.109591; break;
      case 11: scores[0] += -0.013937; scores[1] += 0.033859; scores[2] += -0.019922; break;
      case 12: scores[0] += 0.006000; scores[1] += 0.028166; scores[2] += -0.034166; break;
      case 13: scores[0] += -0.036574; scores[1] += 0.076072; scores[2] += -0.039498; break;
      case 14: scores[0] += -0.042974; scores[1] += -0.042151; scores[2] += 0.085125; break;
      case 15: scores[0] += -0.005821; scores[1] += 0.015760; scores[2] += -0.009938; break;
    }
  }

  // Tree 15 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[11] > 0.03229166567325592) << 1) | ((features[23] > 0.5) << 2) | ((features[13] > 0.39208072423934937) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.040959; scores[1] += 0.051580; scores[2] += -0.010620; break;
      case 1: scores[0] += -0.060432; scores[1] += 0.036427; scores[2] += 0.024005; break;
      case 2: scores[0] += 0.028977; scores[1] += -0.031002; scores[2] += 0.002025; break;
      case 3: scores[0] += -0.039003; scores[1] += -0.033681; scores[2] += 0.072684; break;
      case 4: scores[0] += -0.038813; scores[1] += 0.080960; scores[2] += -0.042148; break;
      case 5: scores[0] += -0.032107; scores[1] += 0.069778; scores[2] += -0.037671; break;
      case 6: scores[0] += -0.037274; scores[1] += 0.071991; scores[2] += -0.034717; break;
      case 7: scores[0] += -0.009455; scores[1] += 0.027272; scores[2] += -0.017817; break;
      case 8: scores[0] += 0.006913; scores[1] += 0.021507; scores[2] += -0.028419; break;
      case 9: scores[0] += -0.066273; scores[1] += -0.041037; scores[2] += 0.107311; break;
      case 10: scores[0] += 0.060299; scores[1] += -0.036319; scores[2] += -0.023980; break;
      case 11: scores[0] += -0.014183; scores[1] += -0.042357; scores[2] += 0.056539; break;
      case 12: scores[0] += -0.028745; scores[1] += 0.060353; scores[2] += -0.031609; break;
      case 13: scores[0] += -0.005223; scores[1] += 0.013107; scores[2] += -0.007884; break;
      case 14: scores[0] += -0.027784; scores[1] += 0.061506; scores[2] += -0.033722; break;
      case 15: scores[0] += -0.006067; scores[1] += 0.017369; scores[2] += -0.011302; break;
    }
  }

  // Tree 16 (depth=4)
  {
    const leafIdx = ((features[11] > 0.035098522901535034) << 0) | ((features[13] > 0.9354166984558105) << 1) | ((features[44] > 0.3500000238418579) << 2) | ((features[45] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.052296; scores[1] += 0.029709; scores[2] += 0.022587; break;
      case 1: scores[0] += 0.016578; scores[1] += -0.035134; scores[2] += 0.018555; break;
      case 2: scores[0] += 0.032877; scores[1] += 0.008859; scores[2] += -0.041735; break;
      case 3: scores[0] += 0.092094; scores[1] += -0.042017; scores[2] += -0.050077; break;
      case 4: scores[0] += -0.039228; scores[1] += 0.064103; scores[2] += -0.024874; break;
      case 5: scores[0] += -0.054899; scores[1] += -0.002614; scores[2] += 0.057513; break;
      case 6: scores[0] += -0.012499; scores[1] += 0.042759; scores[2] += -0.030260; break;
      case 7: scores[0] += 0.058443; scores[1] += -0.002641; scores[2] += -0.055802; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.036574; scores[1] += 0.074704; scores[2] += -0.038130; break;
      case 13: scores[0] += -0.035434; scores[1] += 0.076015; scores[2] += -0.040580; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 17 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[11] > 0.033908046782016754) << 1) | ((features[23] > 0.5) << 2) | ((features[13] > 0.8660714626312256) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.061369; scores[1] += 0.034697; scores[2] += 0.026673; break;
      case 1: scores[0] += 0.005010; scores[1] += 0.028142; scores[2] += -0.033152; break;
      case 2: scores[0] += -0.037733; scores[1] += -0.010152; scores[2] += 0.047885; break;
      case 3: scores[0] += 0.075136; scores[1] += -0.037547; scores[2] += -0.037589; break;
      case 4: scores[0] += -0.037785; scores[1] += 0.078550; scores[2] += -0.040765; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.037801; scores[1] += 0.073432; scores[2] += -0.035631; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.013330; scores[1] += 0.013801; scores[2] += -0.000471; break;
      case 9: scores[0] += 0.035389; scores[1] += 0.020895; scores[2] += -0.056284; break;
      case 10: scores[0] += 0.086002; scores[1] += -0.023010; scores[2] += -0.062991; break;
      case 11: scores[0] += 0.067740; scores[1] += -0.034687; scores[2] += -0.033053; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 18 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[15] > 0.5) << 1) | ((features[44] > 0.3500000238418579) << 2) | ((features[38] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.045549; scores[1] += 0.023628; scores[2] += 0.021921; break;
      case 1: scores[0] += 0.038307; scores[1] += 0.015884; scores[2] += -0.054192; break;
      case 2: scores[0] += 0.164712; scores[1] += -0.102953; scores[2] += -0.061759; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.035657; scores[1] += 0.056558; scores[2] += -0.020901; break;
      case 5: scores[0] += -0.013534; scores[1] += 0.038976; scores[2] += -0.025442; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.011235; scores[1] += -0.041018; scores[2] += 0.052253; break;
      case 9: scores[0] += 0.076315; scores[1] += -0.040517; scores[2] += -0.035799; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.061068; scores[1] += 0.036996; scores[2] += 0.024072; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 19 (depth=4)
  {
    const leafIdx = ((features[13] > 0.7559523582458496) << 0) | ((features[13] > 0.8074073791503906) << 1) | ((features[22] > 0.5) << 2) | ((features[11] > 0.029857397079467773) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.034892; scores[1] += 0.049105; scores[2] += -0.014213; break;
      case 1: scores[0] += -0.002707; scores[1] += 0.006821; scores[2] += -0.004114; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.020548; scores[1] += 0.012985; scores[2] += -0.033534; break;
      case 4: scores[0] += -0.065515; scores[1] += 0.020463; scores[2] += 0.045052; break;
      case 5: scores[0] += -0.026018; scores[1] += -0.044441; scores[2] += 0.070459; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.010856; scores[1] += -0.005939; scores[2] += 0.016795; break;
      case 8: scores[0] += 0.008383; scores[1] += -0.007992; scores[2] += -0.000391; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.079358; scores[1] += -0.025288; scores[2] += -0.054070; break;
      case 12: scores[0] += -0.039851; scores[1] += -0.025578; scores[2] += 0.065429; break;
      case 13: scores[0] += -0.013029; scores[1] += -0.013816; scores[2] += 0.026845; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.061285; scores[1] += -0.029199; scores[2] += -0.032086; break;
    }
  }

  // Tree 20 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[13] > 0.029857397079467773) << 1) | ((features[44] > 0.25) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.021975; scores[1] += -0.036387; scores[2] += 0.014412; break;
      case 1: scores[0] += -0.032049; scores[1] += 0.012552; scores[2] += 0.019497; break;
      case 2: scores[0] += 0.017865; scores[1] += 0.013178; scores[2] += -0.031042; break;
      case 3: scores[0] += -0.014219; scores[1] += 0.057117; scores[2] += -0.042897; break;
      case 4: scores[0] += -0.048851; scores[1] += 0.071804; scores[2] += -0.022953; break;
      case 5: scores[0] += -0.039170; scores[1] += 0.075339; scores[2] += -0.036169; break;
      case 6: scores[0] += -0.021289; scores[1] += 0.033392; scores[2] += -0.012103; break;
      case 7: scores[0] += -0.046513; scores[1] += -0.032252; scores[2] += 0.078765; break;
      case 8: scores[0] += 0.065120; scores[1] += -0.041500; scores[2] += -0.023620; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.035368; scores[1] += -0.053312; scores[2] += 0.017945; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.019773; scores[1] += -0.011909; scores[2] += 0.031682; break;
      case 13: scores[0] += -0.035814; scores[1] += -0.035119; scores[2] += 0.070933; break;
      case 14: scores[0] += -0.000811; scores[1] += 0.010167; scores[2] += -0.009357; break;
      case 15: scores[0] += 0.005971; scores[1] += -0.045604; scores[2] += 0.039632; break;
    }
  }

  // Tree 21 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[11] > 0.026671409606933594) << 1) | ((features[13] > 0.6408730149269104) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.008900; scores[1] += 0.026585; scores[2] += -0.017685; break;
      case 1: scores[0] += -0.052425; scores[1] += 0.037785; scores[2] += 0.014640; break;
      case 2: scores[0] += 0.019412; scores[1] += -0.019072; scores[2] += -0.000340; break;
      case 3: scores[0] += -0.046098; scores[1] += -0.015472; scores[2] += 0.061571; break;
      case 4: scores[0] += 0.008791; scores[1] += 0.041479; scores[2] += -0.050270; break;
      case 5: scores[0] += -0.002889; scores[1] += -0.019047; scores[2] += 0.021936; break;
      case 6: scores[0] += 0.033194; scores[1] += -0.018625; scores[2] += -0.014569; break;
      case 7: scores[0] += -0.011263; scores[1] += 0.008371; scores[2] += 0.002892; break;
      case 8: scores[0] += -0.056307; scores[1] += 0.059998; scores[2] += -0.003692; break;
      case 9: scores[0] += -0.051726; scores[1] += -0.009103; scores[2] += 0.060830; break;
      case 10: scores[0] += -0.035471; scores[1] += 0.022772; scores[2] += 0.012699; break;
      case 11: scores[0] += -0.014978; scores[1] += -0.037357; scores[2] += 0.052335; break;
      case 12: scores[0] += 0.021333; scores[1] += 0.007766; scores[2] += -0.029100; break;
      case 13: scores[0] += -0.036758; scores[1] += -0.034780; scores[2] += 0.071537; break;
      case 14: scores[0] += 0.073802; scores[1] += -0.019046; scores[2] += -0.054757; break;
      case 15: scores[0] += 0.042626; scores[1] += -0.035590; scores[2] += -0.007036; break;
    }
  }

  // Tree 22 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[9] > 1.5) << 1) | ((features[10] > 4.224999904632568) << 2) | ((features[10] > 5.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.041506; scores[1] += 0.061041; scores[2] += -0.019535; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.032952; scores[1] += 0.074929; scores[2] += -0.041977; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.124836; scores[1] += -0.063515; scores[2] += -0.061321; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.043809; scores[1] += 0.062759; scores[2] += -0.018950; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.044190; scores[1] += 0.006119; scores[2] += -0.050309; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.040073; scores[1] += 0.020258; scores[2] += 0.019815; break;
      case 15: scores[0] += 0.158089; scores[1] += -0.101292; scores[2] += -0.056796; break;
    }
  }

  // Tree 23 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[28] > 0.5) << 1) | ((features[10] > 4.449999809265137) << 2) | ((features[13] > 0.3867521286010742) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.027897; scores[1] += 0.053309; scores[2] += -0.025412; break;
      case 1: scores[0] += 0.012570; scores[1] += -0.009615; scores[2] += -0.002955; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.059274; scores[1] += 0.038295; scores[2] += 0.020979; break;
      case 5: scores[0] += 0.056389; scores[1] += -0.021153; scores[2] += -0.035236; break;
      case 6: scores[0] += -0.033409; scores[1] += 0.076647; scores[2] += -0.043238; break;
      case 7: scores[0] += -0.027547; scores[1] += 0.044146; scores[2] += -0.016600; break;
      case 8: scores[0] += -0.032771; scores[1] += 0.061876; scores[2] += -0.029105; break;
      case 9: scores[0] += -0.043557; scores[1] += 0.059630; scores[2] += -0.016073; break;
      case 10: scores[0] += -0.005048; scores[1] += 0.015320; scores[2] += -0.010272; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.002794; scores[1] += -0.026264; scores[2] += 0.023470; break;
      case 13: scores[0] += 0.047252; scores[1] += 0.004375; scores[2] += -0.051627; break;
      case 14: scores[0] += -0.029258; scores[1] += 0.070830; scores[2] += -0.041572; break;
      case 15: scores[0] += -0.027528; scores[1] += 0.044789; scores[2] += -0.017261; break;
    }
  }

  // Tree 24 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.35599076747894287) << 1) | ((features[30] > 0.5) << 2) | ((features[43] > 0.1558704376220703) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.023333; scores[1] += 0.034839; scores[2] += -0.011506; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.009535; scores[1] += -0.022818; scores[2] += 0.032353; break;
      case 3: scores[0] += 0.145067; scores[1] += -0.091592; scores[2] += -0.053475; break;
      case 4: scores[0] += 0.020775; scores[1] += -0.013531; scores[2] += -0.007244; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.025410; scores[1] += -0.005889; scores[2] += -0.019521; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.043922; scores[1] += 0.069768; scores[2] += -0.025845; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.034550; scores[1] += 0.046950; scores[2] += -0.012400; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.029650; scores[1] += -0.078633; scores[2] += 0.108283; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.015027; scores[1] += 0.001049; scores[2] += 0.013977; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 25 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[4] > 0.5) << 1) | ((features[9] > 3.5) << 2) | ((features[43] > 0.3060200810432434) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.031742; scores[1] += 0.012022; scores[2] += 0.019720; break;
      case 1: scores[0] += 0.133080; scores[1] += -0.083624; scores[2] += -0.049455; break;
      case 2: scores[0] += 0.049341; scores[1] += -0.004411; scores[2] += -0.044930; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.035799; scores[1] += 0.043897; scores[2] += -0.008099; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.055498; scores[1] += 0.009377; scores[2] += 0.046122; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.010602; scores[1] += 0.026744; scores[2] += -0.037346; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.020111; scores[1] += 0.051431; scores[2] += -0.031320; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 26 (depth=4)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[29] > 0.5) << 1) | ((features[44] > 0.15000000596046448) << 2) | ((features[13] > 0.46291208267211914) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.051397; scores[1] += -0.017405; scores[2] += -0.033992; break;
      case 1: scores[0] += -0.031688; scores[1] += 0.050909; scores[2] += -0.019221; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.054632; scores[1] += 0.036107; scores[2] += 0.018525; break;
      case 5: scores[0] += -0.031013; scores[1] += 0.072520; scores[2] += -0.041507; break;
      case 6: scores[0] += -0.055820; scores[1] += -0.001111; scores[2] += 0.056931; break;
      case 7: scores[0] += -0.008541; scores[1] += 0.029378; scores[2] += -0.020837; break;
      case 8: scores[0] += 0.035892; scores[1] += 0.017407; scores[2] += -0.053299; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.018227; scores[1] += -0.013135; scores[2] += -0.005092; break;
      case 13: scores[0] += -0.025170; scores[1] += 0.059293; scores[2] += -0.034123; break;
      case 14: scores[0] += -0.022869; scores[1] += -0.016225; scores[2] += 0.039093; break;
      case 15: scores[0] += -0.013743; scores[1] += 0.042258; scores[2] += -0.028515; break;
    }
  }

  // Tree 27 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.5166851878166199) << 1) | ((features[11] > 0.03077651560306549) << 2) | ((features[13] > 0.9245014190673828) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.045766; scores[1] += 0.034770; scores[2] += 0.010996; break;
      case 1: scores[0] += 0.078076; scores[1] += -0.052372; scores[2] += -0.025704; break;
      case 2: scores[0] += -0.047152; scores[1] += 0.013935; scores[2] += 0.033217; break;
      case 3: scores[0] += 0.073171; scores[1] += -0.047700; scores[2] += -0.025472; break;
      case 4: scores[0] += 0.000047; scores[1] += -0.017087; scores[2] += 0.017040; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000268; scores[1] += 0.002863; scores[2] += -0.003131; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.014443; scores[1] += 0.010966; scores[2] += -0.025409; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.078371; scores[1] += -0.029768; scores[2] += -0.048603; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 28 (depth=4)
  {
    const leafIdx = ((features[0] > 0.5) << 0) | ((features[9] > 3.5) << 1) | ((features[34] > 0.15000000596046448) << 2) | ((features[44] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.028117; scores[1] += 0.014215; scores[2] += -0.042331; break;
      case 1: scores[0] += 0.065958; scores[1] += -0.033023; scores[2] += -0.032934; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.026413; scores[1] += 0.011029; scores[2] += 0.015383; break;
      case 9: scores[0] += -0.012063; scores[1] += -0.043916; scores[2] += 0.055979; break;
      case 10: scores[0] += -0.017149; scores[1] += 0.049450; scores[2] += -0.032301; break;
      case 11: scores[0] += -0.018705; scores[1] += -0.019948; scores[2] += 0.038653; break;
      case 12: scores[0] += 0.016119; scores[1] += -0.000059; scores[2] += -0.016060; break;
      case 13: scores[0] += 0.111076; scores[1] += -0.041243; scores[2] += -0.069833; break;
      case 14: scores[0] += -0.028558; scores[1] += 0.039828; scores[2] += -0.011271; break;
      case 15: scores[0] += -0.047875; scores[1] += 0.016706; scores[2] += 0.031169; break;
    }
  }

  // Tree 29 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[10] > 4.775000095367432) << 2) | ((features[23] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.042230; scores[1] += 0.057298; scores[2] += -0.015068; break;
      case 1: scores[0] += -0.015290; scores[1] += 0.056881; scores[2] += -0.041591; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.003260; scores[1] += -0.004204; scores[2] += 0.007464; break;
      case 5: scores[0] += -0.022399; scores[1] += 0.065701; scores[2] += -0.043303; break;
      case 6: scores[0] += 0.038655; scores[1] += -0.055515; scores[2] += 0.016860; break;
      case 7: scores[0] += -0.018563; scores[1] += -0.035546; scores[2] += 0.054109; break;
      case 8: scores[0] += -0.019979; scores[1] += 0.050770; scores[2] += -0.030791; break;
      case 9: scores[0] += -0.006107; scores[1] += 0.018486; scores[2] += -0.012379; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.034033; scores[1] += 0.069690; scores[2] += -0.035657; break;
      case 13: scores[0] += -0.011168; scores[1] += 0.039331; scores[2] += -0.028163; break;
      case 14: scores[0] += -0.020975; scores[1] += 0.056844; scores[2] += -0.035869; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 30 (depth=4)
  {
    const leafIdx = ((features[30] > 0.5) << 0) | ((features[43] > 0.23669467866420746) << 1) | ((features[41] > 0.5) << 2) | ((features[44] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.041892; scores[1] += -0.023059; scores[2] += -0.018834; break;
      case 1: scores[0] += 0.062983; scores[1] += -0.031104; scores[2] += -0.031879; break;
      case 2: scores[0] += -0.045054; scores[1] += 0.048391; scores[2] += -0.003338; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.019442; scores[1] += 0.025520; scores[2] += -0.044963; break;
      case 5: scores[0] += 0.046792; scores[1] += -0.015954; scores[2] += -0.030838; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.018540; scores[1] += 0.022371; scores[2] += -0.003831; break;
      case 8: scores[0] += -0.035619; scores[1] += 0.027746; scores[2] += 0.007872; break;
      case 9: scores[0] += -0.051086; scores[1] += 0.024245; scores[2] += 0.026842; break;
      case 10: scores[0] += -0.034117; scores[1] += 0.070149; scores[2] += -0.036031; break;
      case 11: scores[0] += -0.037975; scores[1] += -0.065007; scores[2] += 0.102982; break;
      case 12: scores[0] += 0.010070; scores[1] += -0.025013; scores[2] += 0.014943; break;
      case 13: scores[0] += 0.072310; scores[1] += -0.024835; scores[2] += -0.047476; break;
      case 14: scores[0] += 0.012521; scores[1] += -0.034882; scores[2] += 0.022362; break;
      case 15: scores[0] += 0.001867; scores[1] += 0.006952; scores[2] += -0.008819; break;
    }
  }

  // Tree 31 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[34] > 0.05000000074505806) << 1) | ((features[13] > 0.27888888120651245) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001125; scores[1] += 0.036631; scores[2] += -0.035506; break;
      case 1: scores[0] += -0.040020; scores[1] += 0.049854; scores[2] += -0.009834; break;
      case 2: scores[0] += 0.026442; scores[1] += -0.027355; scores[2] += 0.000913; break;
      case 3: scores[0] += -0.022932; scores[1] += -0.039569; scores[2] += 0.062502; break;
      case 4: scores[0] += -0.008560; scores[1] += 0.005409; scores[2] += 0.003152; break;
      case 5: scores[0] += -0.033592; scores[1] += -0.044780; scores[2] += 0.078372; break;
      case 6: scores[0] += 0.023145; scores[1] += -0.004528; scores[2] += -0.018617; break;
      case 7: scores[0] += -0.011894; scores[1] += -0.026688; scores[2] += 0.038582; break;
      case 8: scores[0] += -0.057225; scores[1] += 0.020204; scores[2] += 0.037020; break;
      case 9: scores[0] += -0.021157; scores[1] += 0.026800; scores[2] += -0.005643; break;
      case 10: scores[0] += -0.031979; scores[1] += 0.044410; scores[2] += -0.012431; break;
      case 11: scores[0] += -0.020063; scores[1] += -0.003158; scores[2] += 0.023221; break;
      case 12: scores[0] += -0.009918; scores[1] += -0.004080; scores[2] += 0.013997; break;
      case 13: scores[0] += -0.014700; scores[1] += -0.008938; scores[2] += 0.023638; break;
      case 14: scores[0] += -0.039472; scores[1] += 0.062174; scores[2] += -0.022701; break;
      case 15: scores[0] += -0.010275; scores[1] += 0.008730; scores[2] += 0.001545; break;
    }
  }

  // Tree 32 (depth=4)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[15] > 0.5) << 1) | ((features[23] > 0.5) << 2) | ((features[26] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002681; scores[1] += -0.012356; scores[2] += 0.009675; break;
      case 1: scores[0] += -0.028036; scores[1] += 0.068258; scores[2] += -0.040222; break;
      case 2: scores[0] += 0.119647; scores[1] += -0.075035; scores[2] += -0.044611; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.033908; scores[1] += 0.070058; scores[2] += -0.036150; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.036729; scores[1] += 0.054503; scores[2] += -0.017774; break;
      case 9: scores[0] += -0.031261; scores[1] += 0.067400; scores[2] += -0.036139; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 33 (depth=4)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[9] > 3.5) << 1) | ((features[0] > 0.5) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003040; scores[1] += 0.004227; scores[2] += -0.007267; break;
      case 1: scores[0] += -0.030650; scores[1] += 0.067500; scores[2] += -0.036850; break;
      case 2: scores[0] += -0.008659; scores[1] += 0.031050; scores[2] += -0.022391; break;
      case 3: scores[0] += -0.025312; scores[1] += 0.061173; scores[2] += -0.035861; break;
      case 4: scores[0] += 0.053754; scores[1] += -0.049777; scores[2] += -0.003978; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.040073; scores[1] += 0.016903; scores[2] += 0.023171; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.040931; scores[1] += 0.000469; scores[2] += 0.040463; break;
      case 9: scores[0] += -0.000840; scores[1] += 0.006131; scores[2] += -0.005291; break;
      case 10: scores[0] += -0.031245; scores[1] += 0.047943; scores[2] += -0.016698; break;
      case 11: scores[0] += -0.005807; scores[1] += 0.028962; scores[2] += -0.023155; break;
      case 12: scores[0] += -0.000126; scores[1] += -0.043985; scores[2] += 0.044110; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.017021; scores[1] += -0.031006; scores[2] += 0.048027; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 34 (depth=4)
  {
    const leafIdx = ((features[10] > 4.775000095367432) << 0) | ((features[11] > 0.03077651560306549) << 1) | ((features[9] > 4.5) << 2) | ((features[45] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.040893; scores[1] += 0.055069; scores[2] += -0.014176; break;
      case 1: scores[0] += -0.010117; scores[1] += 0.004886; scores[2] += 0.005231; break;
      case 2: scores[0] += -0.011601; scores[1] += 0.047783; scores[2] += -0.036182; break;
      case 3: scores[0] += 0.024355; scores[1] += -0.034299; scores[2] += 0.009944; break;
      case 4: scores[0] += -0.003753; scores[1] += 0.012921; scores[2] += -0.009168; break;
      case 5: scores[0] += -0.020689; scores[1] += 0.054747; scores[2] += -0.034057; break;
      case 6: scores[0] += -0.003155; scores[1] += 0.009764; scores[2] += -0.006609; break;
      case 7: scores[0] += -0.023420; scores[1] += 0.050377; scores[2] += -0.026957; break;
      case 8: scores[0] += -0.008944; scores[1] += 0.023826; scores[2] += -0.014882; break;
      case 9: scores[0] += -0.023104; scores[1] += 0.054427; scores[2] += -0.031324; break;
      case 10: scores[0] += -0.003404; scores[1] += 0.009800; scores[2] += -0.006396; break;
      case 11: scores[0] += -0.024013; scores[1] += 0.060205; scores[2] += -0.036192; break;
      case 12: scores[0] += -0.010209; scores[1] += 0.027840; scores[2] += -0.017631; break;
      case 13: scores[0] += -0.010963; scores[1] += 0.031522; scores[2] += -0.020559; break;
      case 14: scores[0] += -0.001801; scores[1] += 0.006846; scores[2] += -0.005045; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 35 (depth=4)
  {
    const leafIdx = ((features[45] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[43] > 0.12132352590560913) << 2) | ((features[10] > 7.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.025394; scores[1] += 0.038377; scores[2] += -0.012983; break;
      case 1: scores[0] += -0.022510; scores[1] += 0.054193; scores[2] += -0.031682; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.004270; scores[1] += -0.013615; scores[2] += 0.017885; break;
      case 5: scores[0] += -0.015265; scores[1] += 0.039790; scores[2] += -0.024525; break;
      case 6: scores[0] += -0.028893; scores[1] += 0.050674; scores[2] += -0.021781; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.018961; scores[1] += -0.020353; scores[2] += 0.001393; break;
      case 9: scores[0] += -0.024053; scores[1] += 0.059219; scores[2] += -0.035166; break;
      case 10: scores[0] += -0.010798; scores[1] += 0.010535; scores[2] += 0.000263; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.047354; scores[1] += -0.007471; scores[2] += 0.054825; break;
      case 13: scores[0] += -0.005462; scores[1] += 0.014032; scores[2] += -0.008571; break;
      case 14: scores[0] += -0.031992; scores[1] += 0.062478; scores[2] += -0.030486; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 36 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[9] > 2.5) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.021646; scores[1] += -0.025616; scores[2] += 0.003970; break;
      case 1: scores[0] += -0.018160; scores[1] += 0.001130; scores[2] += 0.017030; break;
      case 2: scores[0] += -0.019688; scores[1] += -0.021175; scores[2] += 0.040863; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.021517; scores[1] += 0.023443; scores[2] += -0.001926; break;
      case 5: scores[0] += -0.057024; scores[1] += 0.025385; scores[2] += 0.031639; break;
      case 6: scores[0] += -0.020764; scores[1] += -0.031045; scores[2] += 0.051809; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.023507; scores[1] += 0.015181; scores[2] += -0.038688; break;
      case 9: scores[0] += -0.001751; scores[1] += 0.015692; scores[2] += -0.013941; break;
      case 10: scores[0] += -0.002568; scores[1] += -0.026343; scores[2] += 0.028912; break;
      case 11: scores[0] += -0.007449; scores[1] += 0.049997; scores[2] += -0.042549; break;
      case 12: scores[0] += -0.039162; scores[1] += 0.033056; scores[2] += 0.006106; break;
      case 13: scores[0] += -0.007367; scores[1] += -0.035313; scores[2] += 0.042681; break;
      case 14: scores[0] += 0.009283; scores[1] += 0.024097; scores[2] += -0.033380; break;
      case 15: scores[0] += -0.002322; scores[1] += 0.023877; scores[2] += -0.021555; break;
    }
  }

  // Tree 37 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[13] > 0.04257246479392052) << 2) | ((features[32] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.059654; scores[1] += -0.044373; scores[2] += -0.015281; break;
      case 1: scores[0] += 0.031363; scores[1] += -0.016879; scores[2] += -0.014484; break;
      case 2: scores[0] += -0.050828; scores[1] += 0.034416; scores[2] += 0.016413; break;
      case 3: scores[0] += -0.037217; scores[1] += 0.080870; scores[2] += -0.043653; break;
      case 4: scores[0] += 0.019698; scores[1] += 0.030381; scores[2] += -0.050079; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.008554; scores[1] += -0.002868; scores[2] += 0.011422; break;
      case 7: scores[0] += -0.039222; scores[1] += 0.033767; scores[2] += 0.005455; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.007525; scores[1] += 0.028952; scores[2] += -0.021427; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.113538; scores[1] += -0.071925; scores[2] += -0.041614; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 38 (depth=4)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[15] > 0.5) << 1) | ((features[29] > 0.5) << 2) | ((features[3] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.018549; scores[1] += -0.012747; scores[2] += -0.005802; break;
      case 1: scores[0] += -0.022500; scores[1] += 0.018855; scores[2] += 0.003646; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.104907; scores[1] += -0.066290; scores[2] += -0.038617; break;
      case 4: scores[0] += -0.038414; scores[1] += 0.021841; scores[2] += 0.016573; break;
      case 5: scores[0] += -0.035134; scores[1] += -0.003632; scores[2] += 0.038766; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.019971; scores[1] += 0.019430; scores[2] += -0.039401; break;
      case 9: scores[0] += -0.045617; scores[1] += 0.055172; scores[2] += -0.009556; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 39 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[15] > 0.5) << 1) | ((features[43] > 0.3908730149269104) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.019756; scores[1] += 0.003336; scores[2] += 0.016419; break;
      case 1: scores[0] += -0.031614; scores[1] += 0.066370; scores[2] += -0.034757; break;
      case 2: scores[0] += 0.097309; scores[1] += -0.061366; scores[2] += -0.035942; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.046380; scores[1] += 0.025470; scores[2] += 0.020910; break;
      case 5: scores[0] += -0.004344; scores[1] += 0.011389; scores[2] += -0.007045; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.034896; scores[1] += 0.006115; scores[2] += -0.041012; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.016124; scores[1] += 0.016211; scores[2] += -0.032335; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 40 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[9] > 4.5) << 1) | ((features[10] > 4.099999904632568) << 2) | ((features[34] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.033629; scores[1] += 0.058897; scores[2] += -0.025268; break;
      case 1: scores[0] += -0.005013; scores[1] += 0.016279; scores[2] += -0.011266; break;
      case 2: scores[0] += -0.003451; scores[1] += 0.012060; scores[2] += -0.008609; break;
      case 3: scores[0] += -0.002843; scores[1] += 0.008709; scores[2] += -0.005865; break;
      case 4: scores[0] += 0.004915; scores[1] += -0.007641; scores[2] += 0.002725; break;
      case 5: scores[0] += -0.030347; scores[1] += 0.064247; scores[2] += -0.033899; break;
      case 6: scores[0] += -0.019439; scores[1] += 0.055398; scores[2] += -0.035959; break;
      case 7: scores[0] += -0.012682; scores[1] += 0.037624; scores[2] += -0.024943; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.012772; scores[1] += -0.034995; scores[2] += 0.047767; break;
      case 13: scores[0] += -0.007875; scores[1] += 0.021841; scores[2] += -0.013966; break;
      case 14: scores[0] += -0.016537; scores[1] += 0.034041; scores[2] += -0.017503; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 41 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[41] > 0.5) << 1) | ((features[23] > 0.5) << 2) | ((features[10] > 4.900000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.014553; scores[1] += 0.032581; scores[2] += -0.018028; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.038643; scores[1] += 0.054667; scores[2] += -0.016024; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.014415; scores[1] += 0.041390; scores[2] += -0.026975; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.020743; scores[1] += 0.003935; scores[2] += 0.016808; break;
      case 9: scores[0] += 0.090241; scores[1] += -0.056700; scores[2] += -0.033541; break;
      case 10: scores[0] += 0.034281; scores[1] += -0.013777; scores[2] += -0.020505; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.029907; scores[1] += 0.063121; scores[2] += -0.033214; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.004809; scores[1] += 0.012162; scores[2] += -0.007353; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 42 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[13] > 0.5147186517715454) << 1) | ((features[0] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.032986; scores[1] += 0.020738; scores[2] += 0.012248; break;
      case 1: scores[0] += -0.005397; scores[1] += 0.062071; scores[2] += -0.056674; break;
      case 2: scores[0] += -0.009203; scores[1] += 0.000077; scores[2] += 0.009126; break;
      case 3: scores[0] += -0.012071; scores[1] += 0.023127; scores[2] += -0.011056; break;
      case 4: scores[0] += 0.024255; scores[1] += -0.042479; scores[2] += 0.018224; break;
      case 5: scores[0] += -0.008955; scores[1] += -0.027824; scores[2] += 0.036779; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.051086; scores[1] += 0.022150; scores[2] += 0.028935; break;
      case 9: scores[0] += -0.023385; scores[1] += 0.041058; scores[2] += -0.017673; break;
      case 10: scores[0] += 0.021171; scores[1] += -0.007373; scores[2] += -0.013798; break;
      case 11: scores[0] += -0.001047; scores[1] += -0.004393; scores[2] += 0.005440; break;
      case 12: scores[0] += 0.024480; scores[1] += -0.035394; scores[2] += 0.010914; break;
      case 13: scores[0] += -0.009709; scores[1] += -0.023492; scores[2] += 0.033201; break;
      case 14: scores[0] += 0.075236; scores[1] += -0.004540; scores[2] += -0.070696; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 43 (depth=4)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[44] > 0.15000000596046448) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.026944; scores[1] += 0.000050; scores[2] += -0.026994; break;
      case 1: scores[0] += -0.046304; scores[1] += 0.047194; scores[2] += -0.000890; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.045488; scores[1] += -0.006498; scores[2] += 0.051986; break;
      case 5: scores[0] += -0.027544; scores[1] += 0.048254; scores[2] += -0.020710; break;
      case 6: scores[0] += -0.041785; scores[1] += 0.031681; scores[2] += 0.010105; break;
      case 7: scores[0] += -0.009445; scores[1] += 0.017074; scores[2] += -0.007629; break;
      case 8: scores[0] += 0.048931; scores[1] += -0.009616; scores[2] += -0.039315; break;
      case 9: scores[0] += 0.017368; scores[1] += -0.009064; scores[2] += -0.008304; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.022561; scores[1] += -0.022235; scores[2] += -0.000325; break;
      case 13: scores[0] += -0.005043; scores[1] += 0.018146; scores[2] += -0.013102; break;
      case 14: scores[0] += -0.009486; scores[1] += 0.001714; scores[2] += 0.007772; break;
      case 15: scores[0] += -0.013287; scores[1] += 0.042573; scores[2] += -0.029287; break;
    }
  }

  // Tree 44 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.14907407760620117) << 1) | ((features[9] > 2.5) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010060; scores[1] += -0.023740; scores[2] += 0.013680; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.003437; scores[1] += 0.011662; scores[2] += -0.015099; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.044706; scores[1] += 0.060619; scores[2] += -0.015913; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.019502; scores[1] += -0.000883; scores[2] += 0.020385; break;
      case 7: scores[0] += 0.086867; scores[1] += -0.054652; scores[2] += -0.032216; break;
      case 8: scores[0] += 0.045872; scores[1] += -0.039742; scores[2] += -0.006129; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.032216; scores[1] += -0.036898; scores[2] += 0.004681; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.016350; scores[1] += -0.023185; scores[2] += 0.039534; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.050371; scores[1] += -0.013249; scores[2] += -0.037122; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 45 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[2] > 0.5) << 1) | ((features[23] > 0.5) << 2) | ((features[32] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004148; scores[1] += 0.003775; scores[2] += 0.000373; break;
      case 1: scores[0] += -0.012712; scores[1] += -0.012779; scores[2] += 0.025490; break;
      case 2: scores[0] += 0.017247; scores[1] += -0.031233; scores[2] += 0.013986; break;
      case 3: scores[0] += -0.010404; scores[1] += -0.017250; scores[2] += 0.027655; break;
      case 4: scores[0] += -0.028673; scores[1] += 0.061294; scores[2] += -0.032621; break;
      case 5: scores[0] += -0.007467; scores[1] += 0.020568; scores[2] += -0.013101; break;
      case 6: scores[0] += -0.001478; scores[1] += 0.007554; scores[2] += -0.006077; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.081458; scores[1] += -0.051193; scores[2] += -0.030266; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.004900; scores[1] += 0.021616; scores[2] += -0.016716; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 46 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[32] > 0.5) << 1) | ((features[22] > 0.5) << 2) | ((features[13] > 0.1644144058227539) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003374; scores[1] += 0.000635; scores[2] += -0.004009; break;
      case 1: scores[0] += -0.002651; scores[1] += 0.024757; scores[2] += -0.022106; break;
      case 2: scores[0] += -0.004811; scores[1] += 0.021126; scores[2] += -0.016316; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.045583; scores[1] += 0.031155; scores[2] += 0.014428; break;
      case 5: scores[0] += -0.009322; scores[1] += 0.046361; scores[2] += -0.037038; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.003855; scores[1] += 0.006779; scores[2] += -0.010633; break;
      case 9: scores[0] += -0.026447; scores[1] += 0.033808; scores[2] += -0.007362; break;
      case 10: scores[0] += 0.076660; scores[1] += -0.048133; scores[2] += -0.028527; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.011327; scores[1] += -0.026565; scores[2] += 0.037892; break;
      case 13: scores[0] += -0.009475; scores[1] += 0.005229; scores[2] += 0.004246; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 47 (depth=4)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[43] > 0.19615384936332703) << 2) | ((features[13] > 0.6132478713989258) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000701; scores[1] += -0.002436; scores[2] += 0.003137; break;
      case 1: scores[0] += -0.010194; scores[1] += 0.039033; scores[2] += -0.028839; break;
      case 2: scores[0] += -0.039173; scores[1] += 0.026504; scores[2] += 0.012669; break;
      case 3: scores[0] += -0.019066; scores[1] += 0.055550; scores[2] += -0.036484; break;
      case 4: scores[0] += -0.052626; scores[1] += -0.014678; scores[2] += 0.067305; break;
      case 5: scores[0] += -0.025956; scores[1] += 0.058296; scores[2] += -0.032341; break;
      case 6: scores[0] += -0.019292; scores[1] += 0.026310; scores[2] += -0.007018; break;
      case 7: scores[0] += -0.004107; scores[1] += 0.011945; scores[2] += -0.007839; break;
      case 8: scores[0] += 0.035334; scores[1] += -0.000763; scores[2] += -0.034571; break;
      case 9: scores[0] += -0.001444; scores[1] += 0.006026; scores[2] += -0.004582; break;
      case 10: scores[0] += 0.048687; scores[1] += 0.007411; scores[2] += -0.056098; break;
      case 11: scores[0] += -0.007148; scores[1] += 0.019590; scores[2] += -0.012443; break;
      case 12: scores[0] += -0.000815; scores[1] += -0.008469; scores[2] += 0.009284; break;
      case 13: scores[0] += -0.001895; scores[1] += 0.003297; scores[2] += -0.001402; break;
      case 14: scores[0] += -0.018482; scores[1] += 0.017531; scores[2] += 0.000951; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 48 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.8164982795715332) << 1) | ((features[9] > 1.5) << 2) | ((features[43] > 0.1026315838098526) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.056943; scores[1] += -0.042257; scores[2] += -0.014686; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.020708; scores[1] += 0.025648; scores[2] += -0.046356; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.038338; scores[1] += 0.019699; scores[2] += 0.018639; break;
      case 5: scores[0] += 0.072396; scores[1] += -0.045359; scores[2] += -0.027037; break;
      case 6: scores[0] += 0.086189; scores[1] += -0.009521; scores[2] += -0.076667; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.034812; scores[1] += 0.044809; scores[2] += -0.009997; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.017982; scores[1] += 0.007971; scores[2] += -0.025953; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.053654; scores[1] += 0.017474; scores[2] += 0.036180; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.038432; scores[1] += 0.009377; scores[2] += 0.029055; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 49 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[13] > 0.037749290466308594) << 1) | ((features[44] > 0.25) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007436; scores[1] += -0.028736; scores[2] += 0.021300; break;
      case 1: scores[0] += 0.027084; scores[1] += -0.015489; scores[2] += -0.011595; break;
      case 2: scores[0] += -0.014218; scores[1] += 0.025813; scores[2] += -0.011595; break;
      case 3: scores[0] += -0.009652; scores[1] += 0.034824; scores[2] += -0.025172; break;
      case 4: scores[0] += -0.042269; scores[1] += 0.051222; scores[2] += -0.008953; break;
      case 5: scores[0] += -0.020229; scores[1] += 0.078859; scores[2] += -0.058629; break;
      case 6: scores[0] += -0.014224; scores[1] += -0.031763; scores[2] += 0.045986; break;
      case 7: scores[0] += -0.021830; scores[1] += -0.012046; scores[2] += 0.033876; break;
      case 8: scores[0] += 0.045334; scores[1] += -0.033691; scores[2] += -0.011642; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.025277; scores[1] += -0.016978; scores[2] += -0.008299; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.005439; scores[1] += -0.019246; scores[2] += 0.024685; break;
      case 13: scores[0] += -0.008463; scores[1] += -0.022356; scores[2] += 0.030819; break;
      case 14: scores[0] += -0.004161; scores[1] += 0.006155; scores[2] += -0.001993; break;
      case 15: scores[0] += -0.014567; scores[1] += 0.024195; scores[2] += -0.009628; break;
    }
  }

  // Tree 50 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[43] > 0.15192309021949768) << 1) | ((features[33] > 0.5) << 2) | ((features[41] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005639; scores[1] += 0.016593; scores[2] += -0.022231; break;
      case 1: scores[0] += -0.000751; scores[1] += -0.001733; scores[2] += 0.002484; break;
      case 2: scores[0] += -0.004084; scores[1] += 0.016303; scores[2] += -0.012220; break;
      case 3: scores[0] += -0.051105; scores[1] += 0.018359; scores[2] += 0.032746; break;
      case 4: scores[0] += -0.000574; scores[1] += 0.002352; scores[2] += -0.001778; break;
      case 5: scores[0] += -0.030429; scores[1] += 0.037585; scores[2] += -0.007155; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.026299; scores[1] += -0.021738; scores[2] += 0.048037; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.016546; scores[1] += 0.002398; scores[2] += -0.018944; break;
      case 10: scores[0] += -0.040594; scores[1] += 0.040846; scores[2] += -0.000252; break;
      case 11: scores[0] += 0.029191; scores[1] += -0.018867; scores[2] += -0.010324; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.068918; scores[1] += -0.005392; scores[2] += -0.063526; break;
      case 14: scores[0] += -0.017747; scores[1] += 0.052072; scores[2] += -0.034324; break;
      case 15: scores[0] += -0.039984; scores[1] += -0.002719; scores[2] += 0.042703; break;
    }
  }

  // Tree 51 (depth=4)
  {
    const leafIdx = ((features[41] > 0.5) << 0) | ((features[31] > 0.5) << 1) | ((features[43] > 0.18019481003284454) << 2) | ((features[10] > 8.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.035711; scores[1] += 0.033338; scores[2] += 0.002373; break;
      case 1: scores[0] += -0.006510; scores[1] += -0.004767; scores[2] += 0.011277; break;
      case 2: scores[0] += -0.008806; scores[1] += 0.001107; scores[2] += 0.007699; break;
      case 3: scores[0] += 0.054164; scores[1] += -0.015694; scores[2] += -0.038470; break;
      case 4: scores[0] += -0.045520; scores[1] += -0.029433; scores[2] += 0.074953; break;
      case 5: scores[0] += 0.021879; scores[1] += 0.001569; scores[2] += -0.023447; break;
      case 6: scores[0] += -0.032317; scores[1] += 0.050774; scores[2] += -0.018457; break;
      case 7: scores[0] += -0.028455; scores[1] += 0.014006; scores[2] += 0.014449; break;
      case 8: scores[0] += 0.001464; scores[1] += -0.017250; scores[2] += 0.015786; break;
      case 9: scores[0] += 0.021068; scores[1] += 0.005099; scores[2] += -0.026167; break;
      case 10: scores[0] += 0.061419; scores[1] += -0.021026; scores[2] += -0.040393; break;
      case 11: scores[0] += 0.037557; scores[1] += 0.009726; scores[2] += -0.047283; break;
      case 12: scores[0] += -0.039791; scores[1] += 0.033837; scores[2] += 0.005954; break;
      case 13: scores[0] += -0.028472; scores[1] += 0.042551; scores[2] += -0.014079; break;
      case 14: scores[0] += 0.004394; scores[1] += -0.003524; scores[2] += -0.000870; break;
      case 15: scores[0] += -0.000719; scores[1] += -0.079374; scores[2] += 0.080093; break;
    }
  }

  // Tree 52 (depth=4)
  {
    const leafIdx = ((features[32] > 0.5) << 0) | ((features[35] > 0.5) << 1) | ((features[40] > 0.5) << 2) | ((features[13] > 0.0317540317773819) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.022125; scores[1] += 0.017575; scores[2] += -0.039700; break;
      case 1: scores[0] += -0.003068; scores[1] += 0.014826; scores[2] += -0.011758; break;
      case 2: scores[0] += -0.057963; scores[1] += -0.013011; scores[2] += 0.070975; break;
      case 3: scores[0] += -0.001255; scores[1] += 0.007255; scores[2] += -0.006000; break;
      case 4: scores[0] += 0.006458; scores[1] += -0.012100; scores[2] += 0.005642; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.020818; scores[1] += 0.035209; scores[2] += -0.014390; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002493; scores[1] += -0.000715; scores[2] += -0.001778; break;
      case 9: scores[0] += 0.069415; scores[1] += -0.043194; scores[2] += -0.026221; break;
      case 10: scores[0] += -0.029621; scores[1] += 0.039012; scores[2] += -0.009391; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.012457; scores[1] += -0.010615; scores[2] += 0.023072; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.030393; scores[1] += 0.031150; scores[2] += -0.000757; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 53 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[29] > 0.5) << 1) | ((features[44] > 0.3500000238418579) << 2) | ((features[41] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002248; scores[1] += 0.001959; scores[2] += 0.000289; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.020800; scores[1] += -0.018920; scores[2] += 0.039721; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.036165; scores[1] += 0.037566; scores[2] += -0.001402; break;
      case 5: scores[0] += -0.007521; scores[1] += -0.024000; scores[2] += 0.031521; break;
      case 6: scores[0] += -0.022897; scores[1] += 0.055644; scores[2] += -0.032747; break;
      case 7: scores[0] += -0.013688; scores[1] += 0.021800; scores[2] += -0.008112; break;
      case 8: scores[0] += 0.014350; scores[1] += -0.002656; scores[2] += -0.011694; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.012174; scores[1] += 0.009552; scores[2] += -0.021726; break;
      case 13: scores[0] += -0.001633; scores[1] += 0.003866; scores[2] += -0.002233; break;
      case 14: scores[0] += -0.005552; scores[1] += 0.014243; scores[2] += -0.008690; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 54 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[32] > 0.5) << 1) | ((features[31] > 0.5) << 2) | ((features[29] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005809; scores[1] += 0.000172; scores[2] += 0.005638; break;
      case 1: scores[0] += -0.024582; scores[1] += 0.056699; scores[2] += -0.032116; break;
      case 2: scores[0] += 0.049772; scores[1] += -0.032622; scores[2] += -0.017151; break;
      case 3: scores[0] += -0.003904; scores[1] += 0.018883; scores[2] += -0.014979; break;
      case 4: scores[0] += 0.026255; scores[1] += -0.008253; scores[2] += -0.018002; break;
      case 5: scores[0] += -0.011493; scores[1] += 0.031246; scores[2] += -0.019753; break;
      case 6: scores[0] += 0.037047; scores[1] += -0.023389; scores[2] += -0.013658; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.040490; scores[1] += -0.002430; scores[2] += 0.042920; break;
      case 9: scores[0] += -0.005559; scores[1] += 0.022738; scores[2] += -0.017179; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.009530; scores[1] += 0.016150; scores[2] += -0.006620; break;
      case 13: scores[0] += -0.003901; scores[1] += 0.015764; scores[2] += -0.011863; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 55 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[10] > 6.449999809265137) << 1) | ((features[11] > 0.04446640610694885) << 2) | ((features[9] > 4.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005391; scores[1] += 0.007839; scores[2] += -0.013230; break;
      case 1: scores[0] += 0.036553; scores[1] += -0.024228; scores[2] += -0.012325; break;
      case 2: scores[0] += -0.029225; scores[1] += 0.010408; scores[2] += 0.018817; break;
      case 3: scores[0] += 0.046641; scores[1] += -0.029505; scores[2] += -0.017136; break;
      case 4: scores[0] += -0.022020; scores[1] += 0.056467; scores[2] += -0.034447; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.028783; scores[1] += -0.032866; scores[2] += 0.004084; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.014221; scores[1] += 0.047404; scores[2] += -0.033183; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.003870; scores[1] += 0.015975; scores[2] += -0.012105; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.012010; scores[1] += 0.018474; scores[2] += -0.006465; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.007541; scores[1] += 0.048118; scores[2] += -0.040576; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 56 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[9] > 3.5) << 1) | ((features[13] > 0.8550419807434082) << 2) | ((features[10] > 4.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008567; scores[1] += 0.010019; scores[2] += -0.018586; break;
      case 1: scores[0] += -0.001484; scores[1] += 0.006606; scores[2] += -0.005121; break;
      case 2: scores[0] += -0.004954; scores[1] += 0.017807; scores[2] += -0.012853; break;
      case 3: scores[0] += -0.002855; scores[1] += 0.011590; scores[2] += -0.008735; break;
      case 4: scores[0] += -0.036983; scores[1] += 0.051060; scores[2] += -0.014077; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.013109; scores[1] += -0.001839; scores[2] += 0.014948; break;
      case 9: scores[0] += 0.049020; scores[1] += -0.002894; scores[2] += -0.046126; break;
      case 10: scores[0] += -0.036002; scores[1] += 0.035785; scores[2] += 0.000217; break;
      case 11: scores[0] += -0.026302; scores[1] += 0.013817; scores[2] += 0.012484; break;
      case 12: scores[0] += 0.018294; scores[1] += 0.001061; scores[2] += -0.019355; break;
      case 13: scores[0] += 0.023052; scores[1] += -0.026861; scores[2] += 0.003810; break;
      case 14: scores[0] += 0.054649; scores[1] += -0.019842; scores[2] += -0.034807; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 57 (depth=4)
  {
    const leafIdx = ((features[10] > 8.416666030883789) << 0) | ((features[9] > 1.5) << 1) | ((features[14] > 0.5) << 2) | ((features[43] > 0.043478261679410934) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.019048; scores[1] += -0.036475; scores[2] += 0.017427; break;
      case 1: scores[0] += 0.024249; scores[1] += 0.021485; scores[2] += -0.045734; break;
      case 2: scores[0] += -0.020801; scores[1] += 0.014953; scores[2] += 0.005848; break;
      case 3: scores[0] += -0.025794; scores[1] += -0.007436; scores[2] += 0.033230; break;
      case 4: scores[0] += -0.037166; scores[1] += 0.038956; scores[2] += -0.001790; break;
      case 5: scores[0] += 0.054904; scores[1] += -0.034591; scores[2] += -0.020313; break;
      case 6: scores[0] += -0.001554; scores[1] += 0.021454; scores[2] += -0.019900; break;
      case 7: scores[0] += 0.029244; scores[1] += -0.002962; scores[2] += -0.026281; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.018398; scores[1] += -0.008802; scores[2] += -0.009596; break;
      case 13: scores[0] += -0.023197; scores[1] += 0.050438; scores[2] += -0.027241; break;
      case 14: scores[0] += -0.053102; scores[1] += 0.020233; scores[2] += 0.032869; break;
      case 15: scores[0] += -0.025386; scores[1] += -0.002515; scores[2] += 0.027902; break;
    }
  }

  // Tree 58 (depth=4)
  {
    const leafIdx = ((features[10] > 7.7083330154418945) << 0) | ((features[13] > 0.134848490357399) << 1) | ((features[9] > 1.5) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.035315; scores[1] += -0.026752; scores[2] += -0.008563; break;
      case 1: scores[0] += 0.045019; scores[1] += -0.033273; scores[2] += -0.011746; break;
      case 2: scores[0] += 0.017405; scores[1] += -0.011398; scores[2] += -0.006007; break;
      case 3: scores[0] += 0.010074; scores[1] += 0.038164; scores[2] += -0.048239; break;
      case 4: scores[0] += -0.045450; scores[1] += 0.044137; scores[2] += 0.001313; break;
      case 5: scores[0] += -0.020570; scores[1] += 0.004197; scores[2] += 0.016373; break;
      case 6: scores[0] += -0.020731; scores[1] += 0.021673; scores[2] += -0.000942; break;
      case 7: scores[0] += 0.013173; scores[1] += -0.017596; scores[2] += 0.004423; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.013616; scores[1] += -0.009539; scores[2] += -0.004077; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.026131; scores[1] += 0.044588; scores[2] += -0.018457; break;
      case 13: scores[0] += -0.040604; scores[1] += 0.022776; scores[2] += 0.017828; break;
      case 14: scores[0] += -0.037195; scores[1] += -0.011265; scores[2] += 0.048461; break;
      case 15: scores[0] += 0.015209; scores[1] += -0.027331; scores[2] += 0.012122; break;
    }
  }

  // Tree 59 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[44] > 0.25) << 2) | ((features[28] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.016418; scores[1] += -0.003324; scores[2] += -0.013095; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.037094; scores[1] += -0.018871; scores[2] += 0.055965; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.005227; scores[1] += 0.000146; scores[2] += 0.005082; break;
      case 5: scores[0] += -0.002868; scores[1] += -0.035257; scores[2] += 0.038126; break;
      case 6: scores[0] += -0.041379; scores[1] += 0.034009; scores[2] += 0.007370; break;
      case 7: scores[0] += -0.012130; scores[1] += 0.042915; scores[2] += -0.030786; break;
      case 8: scores[0] += -0.020488; scores[1] += 0.051774; scores[2] += -0.031285; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000637; scores[1] += 0.003232; scores[2] += -0.002596; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.019306; scores[1] += 0.057039; scores[2] += -0.037733; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.005429; scores[1] += 0.024981; scores[2] += -0.019551; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 60 (depth=4)
  {
    const leafIdx = ((features[43] > 0.14550265669822693) << 0) | ((features[30] > 0.5) << 1) | ((features[13] > 0.7171428799629211) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007922; scores[1] += -0.002267; scores[2] += -0.005655; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.018303; scores[1] += -0.074868; scores[2] += 0.056565; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.033618; scores[1] += 0.065962; scores[2] += -0.032344; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.026556; scores[1] += -0.019194; scores[2] += -0.007362; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.011034; scores[1] += -0.011584; scores[2] += 0.022618; break;
      case 9: scores[0] += -0.032728; scores[1] += 0.055387; scores[2] += -0.022659; break;
      case 10: scores[0] += -0.027215; scores[1] += 0.049860; scores[2] += -0.022646; break;
      case 11: scores[0] += -0.015428; scores[1] += -0.051290; scores[2] += 0.066718; break;
      case 12: scores[0] += 0.042867; scores[1] += -0.047728; scores[2] += 0.004861; break;
      case 13: scores[0] += -0.001221; scores[1] += -0.012085; scores[2] += 0.013306; break;
      case 14: scores[0] += 0.049266; scores[1] += 0.004080; scores[2] += -0.053346; break;
      case 15: scores[0] += -0.009434; scores[1] += 0.001264; scores[2] += 0.008170; break;
    }
  }

  // Tree 61 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[10] > 4.775000095367432) << 1) | ((features[9] > 2.5) << 2) | ((features[34] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.033700; scores[1] += 0.041986; scores[2] += -0.008286; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.009527; scores[1] += -0.009508; scores[2] += -0.000019; break;
      case 3: scores[0] += 0.017464; scores[1] += 0.015681; scores[2] += -0.033145; break;
      case 4: scores[0] += -0.025955; scores[1] += 0.033746; scores[2] += -0.007791; break;
      case 5: scores[0] += -0.006002; scores[1] += 0.032253; scores[2] += -0.026252; break;
      case 6: scores[0] += -0.004747; scores[1] += 0.002523; scores[2] += 0.002224; break;
      case 7: scores[0] += -0.028465; scores[1] += 0.036735; scores[2] += -0.008270; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001174; scores[1] += 0.011935; scores[2] += -0.010762; break;
      case 13: scores[0] += -0.001103; scores[1] += 0.009166; scores[2] += -0.008063; break;
      case 14: scores[0] += -0.007075; scores[1] += -0.011816; scores[2] += 0.018891; break;
      case 15: scores[0] += -0.007134; scores[1] += -0.026173; scores[2] += 0.033307; break;
    }
  }

  // Tree 62 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[22] > 0.5) << 1) | ((features[44] > 0.25) << 2) | ((features[25] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.029982; scores[1] += -0.043335; scores[2] += 0.013353; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.008035; scores[1] += 0.005742; scores[2] += 0.002293; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.022289; scores[1] += 0.024349; scores[2] += -0.002060; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.041458; scores[1] += 0.038637; scores[2] += 0.002821; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002518; scores[1] += 0.000752; scores[2] += -0.003270; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.007412; scores[1] += 0.054495; scores[2] += -0.047083; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.009290; scores[1] += 0.012861; scores[2] += -0.003570; break;
      case 13: scores[0] += 0.062887; scores[1] += -0.039213; scores[2] += -0.023674; break;
      case 14: scores[0] += -0.004609; scores[1] += -0.024306; scores[2] += 0.028914; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 63 (depth=4)
  {
    const leafIdx = ((features[13] > 0.3973684310913086) << 0) | ((features[9] > 1.5) << 1) | ((features[11] > 0.0674242451786995) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004193; scores[1] += -0.014525; scores[2] += 0.010332; break;
      case 1: scores[0] += 0.000441; scores[1] += 0.036118; scores[2] += -0.036558; break;
      case 2: scores[0] += -0.047827; scores[1] += 0.035034; scores[2] += 0.012793; break;
      case 3: scores[0] += -0.011800; scores[1] += -0.045186; scores[2] += 0.056986; break;
      case 4: scores[0] += 0.035146; scores[1] += -0.018714; scores[2] += -0.016433; break;
      case 5: scores[0] += 0.018375; scores[1] += -0.012423; scores[2] += -0.005952; break;
      case 6: scores[0] += -0.018510; scores[1] += 0.024187; scores[2] += -0.005676; break;
      case 7: scores[0] += -0.006125; scores[1] += -0.003272; scores[2] += 0.009397; break;
      case 8: scores[0] += 0.019822; scores[1] += -0.007426; scores[2] += -0.012396; break;
      case 9: scores[0] += 0.013835; scores[1] += 0.005944; scores[2] += -0.019779; break;
      case 10: scores[0] += -0.036346; scores[1] += 0.025205; scores[2] += 0.011141; break;
      case 11: scores[0] += -0.003648; scores[1] += -0.004659; scores[2] += 0.008307; break;
      case 12: scores[0] += 0.048985; scores[1] += -0.021156; scores[2] += -0.027829; break;
      case 13: scores[0] += 0.031653; scores[1] += -0.022171; scores[2] += -0.009482; break;
      case 14: scores[0] += -0.010351; scores[1] += -0.011065; scores[2] += 0.021416; break;
      case 15: scores[0] += 0.028147; scores[1] += -0.016539; scores[2] += -0.011609; break;
    }
  }

  // Tree 64 (depth=4)
  {
    const leafIdx = ((features[11] > 0.03637566417455673) << 0) | ((features[10] > 10.833333969116211) << 1) | ((features[31] > 0.5) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006869; scores[1] += -0.003674; scores[2] += 0.010543; break;
      case 1: scores[0] += -0.009714; scores[1] += 0.002407; scores[2] += 0.007308; break;
      case 2: scores[0] += -0.022608; scores[1] += 0.036660; scores[2] += -0.014052; break;
      case 3: scores[0] += 0.045628; scores[1] += -0.051768; scores[2] += 0.006140; break;
      case 4: scores[0] += 0.027296; scores[1] += 0.008177; scores[2] += -0.035473; break;
      case 5: scores[0] += 0.036962; scores[1] += -0.022291; scores[2] += -0.014671; break;
      case 6: scores[0] += 0.017262; scores[1] += -0.006700; scores[2] += -0.010562; break;
      case 7: scores[0] += -0.010939; scores[1] += 0.037454; scores[2] += -0.026515; break;
      case 8: scores[0] += -0.009297; scores[1] += 0.040853; scores[2] += -0.031556; break;
      case 9: scores[0] += -0.008547; scores[1] += -0.029367; scores[2] += 0.037914; break;
      case 10: scores[0] += -0.003560; scores[1] += 0.032754; scores[2] += -0.029194; break;
      case 11: scores[0] += -0.011512; scores[1] += -0.031876; scores[2] += 0.043388; break;
      case 12: scores[0] += -0.021125; scores[1] += -0.011342; scores[2] += 0.032467; break;
      case 13: scores[0] += 0.023006; scores[1] += 0.011330; scores[2] += -0.034336; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.002058; scores[1] += 0.003835; scores[2] += -0.005893; break;
    }
  }

  // Tree 65 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[10] > 10.291666030883789) << 2) | ((features[13] > 0.39208072423934937) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.018661; scores[1] += 0.014186; scores[2] += 0.004475; break;
      case 1: scores[0] += -0.018915; scores[1] += 0.052465; scores[2] += -0.033550; break;
      case 2: scores[0] += -0.035323; scores[1] += 0.029689; scores[2] += 0.005634; break;
      case 3: scores[0] += -0.013078; scores[1] += 0.000104; scores[2] += 0.012974; break;
      case 4: scores[0] += 0.014702; scores[1] += -0.011787; scores[2] += -0.002915; break;
      case 5: scores[0] += 0.014453; scores[1] += -0.008151; scores[2] += -0.006302; break;
      case 6: scores[0] += -0.000733; scores[1] += 0.003710; scores[2] += -0.002977; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.007386; scores[1] += -0.025744; scores[2] += 0.018358; break;
      case 9: scores[0] += -0.002070; scores[1] += -0.007452; scores[2] += 0.009522; break;
      case 10: scores[0] += 0.017739; scores[1] += -0.001191; scores[2] += -0.016547; break;
      case 11: scores[0] += -0.011254; scores[1] += 0.013919; scores[2] += -0.002665; break;
      case 12: scores[0] += -0.003390; scores[1] += 0.014692; scores[2] += -0.011301; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.039325; scores[1] += 0.033687; scores[2] += 0.005638; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 66 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[25] > 0.5) << 2) | ((features[28] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005130; scores[1] += -0.000213; scores[2] += -0.004917; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.027820; scores[1] += -0.010277; scores[2] += 0.038097; break;
      case 5: scores[0] += 0.059988; scores[1] += -0.036713; scores[2] += -0.023275; break;
      case 6: scores[0] += 0.003742; scores[1] += -0.000030; scores[2] += -0.003712; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.003239; scores[1] += 0.018583; scores[2] += -0.015344; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.006184; scores[1] += 0.033022; scores[2] += -0.026839; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.023046; scores[1] += 0.059053; scores[2] += -0.036007; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 67 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[11] > 0.012500000186264515) << 2) | ((features[10] > 13.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003072; scores[1] += 0.003056; scores[2] += 0.000016; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.021869; scores[1] += 0.040778; scores[2] += -0.018909; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.016935; scores[1] += -0.026514; scores[2] += 0.009579; break;
      case 5: scores[0] += -0.019356; scores[1] += 0.028050; scores[2] += -0.008695; break;
      case 6: scores[0] += -0.012070; scores[1] += 0.037461; scores[2] += -0.025391; break;
      case 7: scores[0] += -0.003550; scores[1] += 0.016375; scores[2] += -0.012824; break;
      case 8: scores[0] += -0.025169; scores[1] += 0.058854; scores[2] += -0.033685; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.022210; scores[1] += 0.034878; scores[2] += -0.012668; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.031660; scores[1] += -0.043781; scores[2] += 0.012121; break;
      case 13: scores[0] += 0.007886; scores[1] += -0.004451; scores[2] += -0.003435; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 68 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8245074152946472) << 0) | ((features[13] > 0.8164982795715332) << 1) | ((features[14] > 0.5) << 2) | ((features[2] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.017204; scores[1] += -0.011455; scores[2] += -0.005749; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.012303; scores[1] += 0.043635; scores[2] += -0.031332; break;
      case 4: scores[0] += -0.061536; scores[1] += 0.036388; scores[2] += 0.025148; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003622; scores[1] += 0.022427; scores[2] += -0.018805; break;
      case 7: scores[0] += 0.023252; scores[1] += 0.000642; scores[2] += -0.023894; break;
      case 8: scores[0] += -0.011495; scores[1] += -0.010765; scores[2] += 0.022259; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.009607; scores[1] += -0.006738; scores[2] += -0.002870; break;
      case 12: scores[0] += 0.023756; scores[1] += -0.030080; scores[2] += 0.006324; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.044810; scores[1] += -0.004856; scores[2] += -0.039954; break;
      case 15: scores[0] += 0.015321; scores[1] += -0.035530; scores[2] += 0.020209; break;
    }
  }

  // Tree 69 (depth=4)
  {
    const leafIdx = ((features[44] > 0.3500000238418579) << 0) | ((features[10] > 10.583333969116211) << 1) | ((features[34] > 0.25) << 2) | ((features[34] > 0.44999998807907104) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005881; scores[1] += -0.002616; scores[2] += 0.008497; break;
      case 1: scores[0] += 0.001827; scores[1] += 0.015656; scores[2] += -0.017484; break;
      case 2: scores[0] += 0.007042; scores[1] += -0.002082; scores[2] += -0.004960; break;
      case 3: scores[0] += -0.038315; scores[1] += 0.031310; scores[2] += 0.007005; break;
      case 4: scores[0] += 0.072751; scores[1] += -0.006372; scores[2] += -0.066379; break;
      case 5: scores[0] += -0.006084; scores[1] += -0.021133; scores[2] += 0.027217; break;
      case 6: scores[0] += -0.036003; scores[1] += 0.078204; scores[2] += -0.042202; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.011727; scores[1] += 0.034065; scores[2] += -0.022338; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 70 (depth=4)
  {
    const leafIdx = ((features[8] > 0.5) << 0) | ((features[13] > 0.3693957030773163) << 1) | ((features[14] > 0.5) << 2) | ((features[10] > 11.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.012925; scores[1] += 0.011528; scores[2] += 0.001398; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.017092; scores[1] += -0.050731; scores[2] += 0.033638; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.035829; scores[1] += 0.031286; scores[2] += 0.004544; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.004322; scores[1] += -0.002206; scores[2] += -0.002116; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.027820; scores[1] += -0.029406; scores[2] += 0.001585; break;
      case 9: scores[0] += 0.027081; scores[1] += -0.020271; scores[2] += -0.006810; break;
      case 10: scores[0] += -0.056685; scores[1] += 0.051948; scores[2] += 0.004737; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.021002; scores[1] += 0.012050; scores[2] += 0.008953; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.015646; scores[1] += -0.003267; scores[2] += -0.012379; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 71 (depth=4)
  {
    const leafIdx = ((features[13] > 0.08514492958784103) << 0) | ((features[33] > 0.5) << 1) | ((features[0] > 0.5) << 2) | ((features[13] > 0.5147186517715454) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004171; scores[1] += 0.015794; scores[2] += -0.011623; break;
      case 1: scores[0] += -0.046204; scores[1] += 0.009213; scores[2] += 0.036991; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.032554; scores[1] += 0.033751; scores[2] += -0.001196; break;
      case 4: scores[0] += 0.025997; scores[1] += -0.028765; scores[2] += 0.002768; break;
      case 5: scores[0] += 0.045876; scores[1] += -0.043498; scores[2] += -0.002378; break;
      case 6: scores[0] += -0.018825; scores[1] += -0.025015; scores[2] += 0.043840; break;
      case 7: scores[0] += -0.013415; scores[1] += -0.002189; scores[2] += 0.015603; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.003043; scores[1] += -0.003212; scores[2] += 0.000169; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.006398; scores[1] += 0.002576; scores[2] += -0.008974; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.061003; scores[1] += -0.013736; scores[2] += -0.047267; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.019078; scores[1] += 0.012922; scores[2] += -0.031999; break;
    }
  }

  // Tree 72 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[26] > 0.5) << 1) | ((features[43] > 0.14039409160614014) << 2) | ((features[10] > 8.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.020638; scores[1] += 0.017371; scores[2] += 0.003266; break;
      case 1: scores[0] += 0.052166; scores[1] += -0.031733; scores[2] += -0.020433; break;
      case 2: scores[0] += -0.000856; scores[1] += 0.011111; scores[2] += -0.010256; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.008919; scores[1] += -0.005144; scores[2] += 0.014062; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.020930; scores[1] += 0.039948; scores[2] += -0.019018; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.015516; scores[1] += -0.011202; scores[2] += -0.004315; break;
      case 9: scores[0] += 0.014747; scores[1] += -0.009240; scores[2] += -0.005508; break;
      case 10: scores[0] += -0.015739; scores[1] += 0.021143; scores[2] += -0.005404; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.033198; scores[1] += -0.015451; scores[2] += 0.048649; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.019120; scores[1] += 0.041888; scores[2] += -0.022768; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 73 (depth=4)
  {
    const leafIdx = ((features[44] > 0.44999998807907104) << 0) | ((features[9] > 1.5) << 1) | ((features[10] > 7.900000095367432) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.018753; scores[1] += -0.007915; scores[2] += -0.010837; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.039812; scores[1] += 0.011644; scores[2] += 0.028168; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.025043; scores[1] += 0.012851; scores[2] += -0.037894; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.010395; scores[1] += -0.004800; scores[2] += 0.015195; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.012813; scores[1] += -0.021227; scores[2] += 0.008414; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.025952; scores[1] += 0.017811; scores[2] += 0.008141; break;
      case 11: scores[0] += -0.022975; scores[1] += 0.043369; scores[2] += -0.020394; break;
      case 12: scores[0] += -0.017163; scores[1] += 0.026532; scores[2] += -0.009369; break;
      case 13: scores[0] += -0.023996; scores[1] += 0.038579; scores[2] += -0.014583; break;
      case 14: scores[0] += 0.006056; scores[1] += -0.008907; scores[2] += 0.002850; break;
      case 15: scores[0] += -0.002058; scores[1] += 0.013329; scores[2] += -0.011271; break;
    }
  }

  // Tree 74 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 4.775000095367432) << 1) | ((features[43] > 0.7663043737411499) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002035; scores[1] += 0.031781; scores[2] += -0.029746; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000966; scores[1] += -0.001971; scores[2] += 0.002937; break;
      case 3: scores[0] += -0.002646; scores[1] += -0.026174; scores[2] += 0.028820; break;
      case 4: scores[0] += -0.041228; scores[1] += 0.036061; scores[2] += 0.005166; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.037605; scores[1] += -0.001091; scores[2] += -0.036514; break;
      case 7: scores[0] += 0.011476; scores[1] += -0.034319; scores[2] += 0.022844; break;
      case 8: scores[0] += -0.005297; scores[1] += -0.016439; scores[2] += 0.021737; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000625; scores[1] += 0.007382; scores[2] += -0.006757; break;
      case 11: scores[0] += 0.008292; scores[1] += -0.027699; scores[2] += 0.019408; break;
      case 12: scores[0] += -0.016338; scores[1] += 0.031882; scores[2] += -0.015545; break;
      case 13: scores[0] += -0.008096; scores[1] += 0.027535; scores[2] += -0.019439; break;
      case 14: scores[0] += -0.012823; scores[1] += -0.019100; scores[2] += 0.031923; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 75 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[37] > 0.10000000149011612) << 1) | ((features[26] > 0.5) << 2) | ((features[43] > 0.17028985917568207) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004461; scores[1] += -0.000252; scores[2] += -0.004209; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.002672; scores[1] += 0.016042; scores[2] += -0.013370; break;
      case 3: scores[0] += 0.055117; scores[1] += -0.033100; scores[2] += -0.022017; break;
      case 4: scores[0] += -0.017993; scores[1] += 0.024325; scores[2] += -0.006332; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.014983; scores[1] += -0.007931; scores[2] += 0.022914; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.023293; scores[1] += 0.049655; scores[2] += -0.026362; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 76 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[11] > 0.05971479415893555) << 1) | ((features[27] > 0.5) << 2) | ((features[10] > 4.633333206176758) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.033538; scores[1] += 0.041540; scores[2] += -0.008002; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.003081; scores[1] += 0.018859; scores[2] += -0.015778; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.007007; scores[1] += 0.024524; scores[2] += -0.017517; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.008721; scores[1] += 0.004754; scores[2] += 0.003967; break;
      case 9: scores[0] += 0.052939; scores[1] += -0.031776; scores[2] += -0.021163; break;
      case 10: scores[0] += 0.018993; scores[1] += -0.017828; scores[2] += -0.001165; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.003042; scores[1] += -0.047044; scores[2] += 0.044001; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.011877; scores[1] += -0.006189; scores[2] += -0.005688; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 77 (depth=4)
  {
    const leafIdx = ((features[32] > 0.5) << 0) | ((features[23] > 0.5) << 1) | ((features[41] > 0.5) << 2) | ((features[10] > 4.900000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001296; scores[1] += 0.013815; scores[2] += -0.012520; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.004719; scores[1] += 0.021561; scores[2] += -0.016842; break;
      case 3: scores[0] += -0.000723; scores[1] += 0.004324; scores[2] += -0.003601; break;
      case 4: scores[0] += -0.036171; scores[1] += 0.043139; scores[2] += -0.006968; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.009646; scores[1] += -0.000432; scores[2] += 0.010078; break;
      case 9: scores[0] += 0.050913; scores[1] += -0.030544; scores[2] += -0.020369; break;
      case 10: scores[0] += -0.022239; scores[1] += 0.055070; scores[2] += -0.032831; break;
      case 11: scores[0] += -0.002011; scores[1] += 0.012838; scores[2] += -0.010827; break;
      case 12: scores[0] += 0.015334; scores[1] += -0.007929; scores[2] += -0.007404; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.004181; scores[1] += 0.010221; scores[2] += -0.006040; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 78 (depth=4)
  {
    const leafIdx = ((features[43] > 0.6651785373687744) << 0) | ((features[43] > 0.20942983031272888) << 1) | ((features[30] > 0.5) << 2) | ((features[13] > 0.8550419807434082) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003732; scores[1] += -0.002238; scores[2] += -0.001493; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.024636; scores[1] += 0.048866; scores[2] += -0.024229; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.010714; scores[1] += 0.012270; scores[2] += -0.001556; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.015216; scores[1] += -0.053715; scores[2] += 0.068930; break;
      case 7: scores[0] += -0.008055; scores[1] += -0.002362; scores[2] += 0.010417; break;
      case 8: scores[0] += 0.007734; scores[1] += 0.026773; scores[2] += -0.034507; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.006141; scores[1] += -0.024258; scores[2] += 0.018117; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.034166; scores[1] += -0.005084; scores[2] += -0.029083; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.040825; scores[1] += 0.012807; scores[2] += 0.028018; break;
      case 15: scores[0] += 0.009545; scores[1] += 0.009139; scores[2] += -0.018684; break;
    }
  }

  // Tree 79 (depth=4)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[34] > 0.25) << 2) | ((features[11] > 0.07229965180158615) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.009420; scores[1] += 0.002453; scores[2] += 0.006967; break;
      case 1: scores[0] += 0.017977; scores[1] += -0.043181; scores[2] += 0.025204; break;
      case 2: scores[0] += -0.013087; scores[1] += 0.021888; scores[2] += -0.008801; break;
      case 3: scores[0] += 0.021831; scores[1] += -0.034249; scores[2] += 0.012418; break;
      case 4: scores[0] += 0.029498; scores[1] += -0.018338; scores[2] += -0.011160; break;
      case 5: scores[0] += -0.011758; scores[1] += 0.003216; scores[2] += 0.008542; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.020889; scores[1] += 0.004599; scores[2] += -0.025488; break;
      case 9: scores[0] += 0.024606; scores[1] += -0.019449; scores[2] += -0.005157; break;
      case 10: scores[0] += 0.022878; scores[1] += -0.002182; scores[2] += -0.020696; break;
      case 11: scores[0] += -0.011318; scores[1] += -0.037031; scores[2] += 0.048349; break;
      case 12: scores[0] += 0.060211; scores[1] += -0.002675; scores[2] += -0.057536; break;
      case 13: scores[0] += -0.040104; scores[1] += 0.047650; scores[2] += -0.007545; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 80 (depth=4)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[23] > 0.5) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001410; scores[1] += -0.006560; scores[2] += 0.007971; break;
      case 1: scores[0] += -0.018655; scores[1] += 0.054415; scores[2] += -0.035760; break;
      case 2: scores[0] += -0.028755; scores[1] += 0.041053; scores[2] += -0.012298; break;
      case 3: scores[0] += -0.003590; scores[1] += 0.016893; scores[2] += -0.013304; break;
      case 4: scores[0] += -0.018290; scores[1] += 0.048657; scores[2] += -0.030367; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.004041; scores[1] += 0.018359; scores[2] += -0.014318; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.038246; scores[1] += -0.026145; scores[2] += -0.012101; break;
      case 9: scores[0] += -0.006329; scores[1] += 0.029274; scores[2] += -0.022945; break;
      case 10: scores[0] += -0.012166; scores[1] += 0.032961; scores[2] += -0.020795; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.014163; scores[1] += 0.046526; scores[2] += -0.032364; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000406; scores[1] += 0.001503; scores[2] += -0.001097; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 81 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.8198052048683167) << 1) | ((features[13] > 0.7871376872062683) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000297; scores[1] += -0.005047; scores[2] += 0.005344; break;
      case 1: scores[0] += 0.048316; scores[1] += -0.028842; scores[2] += -0.019474; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.009798; scores[1] += 0.040107; scores[2] += -0.030309; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.029259; scores[1] += 0.021740; scores[2] += 0.007519; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.013890; scores[1] += -0.033925; scores[2] += 0.047816; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.020391; scores[1] += -0.002287; scores[2] += -0.018104; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 82 (depth=4)
  {
    const leafIdx = ((features[43] > 0.1913919448852539) << 0) | ((features[10] > 5.633333206176758) << 1) | ((features[9] > 2.5) << 2) | ((features[13] > 0.9354166984558105) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.023009; scores[1] += -0.000880; scores[2] += -0.022128; break;
      case 1: scores[0] += -0.000992; scores[1] += 0.009362; scores[2] += -0.008371; break;
      case 2: scores[0] += 0.009170; scores[1] += -0.014410; scores[2] += 0.005240; break;
      case 3: scores[0] += -0.025154; scores[1] += 0.026615; scores[2] += -0.001461; break;
      case 4: scores[0] += -0.005168; scores[1] += 0.028568; scores[2] += -0.023400; break;
      case 5: scores[0] += -0.021134; scores[1] += 0.010155; scores[2] += 0.010978; break;
      case 6: scores[0] += -0.008007; scores[1] += 0.007592; scores[2] += 0.000415; break;
      case 7: scores[0] += -0.024970; scores[1] += -0.008769; scores[2] += 0.033739; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.019718; scores[1] += 0.004645; scores[2] += -0.024363; break;
      case 10: scores[0] += 0.020638; scores[1] += 0.014762; scores[2] += -0.035400; break;
      case 11: scores[0] += -0.021674; scores[1] += -0.015794; scores[2] += 0.037468; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.009299; scores[1] += 0.031662; scores[2] += -0.022363; break;
      case 14: scores[0] += 0.013950; scores[1] += 0.027514; scores[2] += -0.041464; break;
      case 15: scores[0] += -0.003200; scores[1] += -0.044387; scores[2] += 0.047587; break;
    }
  }

  // Tree 83 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[10] > 8.291666030883789) << 1) | ((features[9] > 3.5) << 2) | ((features[11] > 0.03077651560306549) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.007983; scores[1] += -0.001745; scores[2] += 0.009728; break;
      case 1: scores[0] += -0.014040; scores[1] += 0.020046; scores[2] += -0.006007; break;
      case 2: scores[0] += -0.013063; scores[1] += 0.010220; scores[2] += 0.002843; break;
      case 3: scores[0] += 0.019381; scores[1] += -0.015332; scores[2] += -0.004049; break;
      case 4: scores[0] += 0.021437; scores[1] += 0.013996; scores[2] += -0.035432; break;
      case 5: scores[0] += 0.032611; scores[1] += -0.010174; scores[2] += -0.022437; break;
      case 6: scores[0] += -0.008171; scores[1] += 0.030241; scores[2] += -0.022070; break;
      case 7: scores[0] += -0.001421; scores[1] += 0.005652; scores[2] += -0.004231; break;
      case 8: scores[0] += -0.028865; scores[1] += 0.047815; scores[2] += -0.018950; break;
      case 9: scores[0] += -0.017107; scores[1] += 0.011470; scores[2] += 0.005637; break;
      case 10: scores[0] += 0.021450; scores[1] += -0.044100; scores[2] += 0.022651; break;
      case 11: scores[0] += 0.056132; scores[1] += -0.006124; scores[2] += -0.050008; break;
      case 12: scores[0] += 0.003425; scores[1] += -0.024633; scores[2] += 0.021208; break;
      case 13: scores[0] += -0.033143; scores[1] += 0.012284; scores[2] += 0.020859; break;
      case 14: scores[0] += -0.005464; scores[1] += 0.006569; scores[2] += -0.001105; break;
      case 15: scores[0] += -0.017743; scores[1] += 0.010456; scores[2] += 0.007287; break;
    }
  }

  // Tree 84 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[14] > 0.5) << 1) | ((features[13] > 0.35388994216918945) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.034829; scores[1] += 0.022556; scores[2] += 0.012273; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.025674; scores[1] += 0.025663; scores[2] += 0.000011; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.008898; scores[1] += -0.033190; scores[2] += 0.042087; break;
      case 5: scores[0] += 0.047071; scores[1] += -0.028081; scores[2] += -0.018990; break;
      case 6: scores[0] += -0.001456; scores[1] += 0.000310; scores[2] += 0.001146; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.046306; scores[1] += -0.038854; scores[2] += -0.007452; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.018382; scores[1] += 0.011923; scores[2] += 0.006459; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.005763; scores[1] += 0.035939; scores[2] += -0.030176; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.020717; scores[1] += 0.001704; scores[2] += -0.022421; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 85 (depth=4)
  {
    const leafIdx = ((features[11] > 0.028991596773266792) << 0) | ((features[43] > 0.23669467866420746) << 1) | ((features[10] > 13.833333969116211) << 2) | ((features[10] > 4.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008572; scores[1] += 0.009111; scores[2] += -0.017683; break;
      case 1: scores[0] += -0.000423; scores[1] += 0.001653; scores[2] += -0.001231; break;
      case 2: scores[0] += -0.033810; scores[1] += 0.042919; scores[2] += -0.009109; break;
      case 3: scores[0] += -0.000768; scores[1] += 0.003566; scores[2] += -0.002798; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002365; scores[1] += 0.006057; scores[2] += -0.008422; break;
      case 9: scores[0] += 0.007870; scores[1] += -0.011042; scores[2] += 0.003173; break;
      case 10: scores[0] += 0.004260; scores[1] += -0.027951; scores[2] += 0.023691; break;
      case 11: scores[0] += -0.027342; scores[1] += 0.024622; scores[2] += 0.002720; break;
      case 12: scores[0] += -0.019837; scores[1] += 0.046887; scores[2] += -0.027050; break;
      case 13: scores[0] += 0.039323; scores[1] += -0.040756; scores[2] += 0.001433; break;
      case 14: scores[0] += -0.022713; scores[1] += 0.037408; scores[2] += -0.014696; break;
      case 15: scores[0] += -0.018692; scores[1] += -0.006134; scores[2] += 0.024826; break;
    }
  }

  // Tree 86 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[13] > 0.4202037453651428) << 1) | ((features[0] > 0.5) << 2) | ((features[10] > 8.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.028074; scores[1] += 0.028853; scores[2] += -0.000779; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000310; scores[1] += 0.025405; scores[2] += -0.025095; break;
      case 3: scores[0] += 0.003089; scores[1] += -0.009392; scores[2] += 0.006303; break;
      case 4: scores[0] += -0.022473; scores[1] += -0.014866; scores[2] += 0.037340; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.002750; scores[1] += 0.024978; scores[2] += -0.022228; break;
      case 7: scores[0] += -0.013172; scores[1] += -0.005525; scores[2] += 0.018696; break;
      case 8: scores[0] += -0.013181; scores[1] += 0.009445; scores[2] += 0.003736; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.005826; scores[1] += -0.008676; scores[2] += 0.014502; break;
      case 12: scores[0] += 0.029795; scores[1] += -0.031197; scores[2] += 0.001402; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.073798; scores[1] += -0.010361; scores[2] += -0.063437; break;
    }
  }

  // Tree 87 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[43] > 0.24500000476837158) << 1) | ((features[29] > 0.5) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002794; scores[1] += 0.002239; scores[2] += 0.000556; break;
      case 1: scores[0] += 0.011246; scores[1] += -0.031183; scores[2] += 0.019937; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.009661; scores[1] += -0.047071; scores[2] += 0.056732; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.018501; scores[1] += 0.001712; scores[2] += -0.020213; break;
      case 9: scores[0] += -0.014330; scores[1] += -0.013346; scores[2] += 0.027676; break;
      case 10: scores[0] += -0.010226; scores[1] += 0.001648; scores[2] += 0.008579; break;
      case 11: scores[0] += -0.001365; scores[1] += 0.016258; scores[2] += -0.014893; break;
      case 12: scores[0] += -0.022383; scores[1] += 0.035051; scores[2] += -0.012668; break;
      case 13: scores[0] += -0.009810; scores[1] += 0.014183; scores[2] += -0.004373; break;
      case 14: scores[0] += -0.011751; scores[1] += -0.044979; scores[2] += 0.056729; break;
      case 15: scores[0] += -0.001153; scores[1] += 0.014961; scores[2] += -0.013809; break;
    }
  }

  // Tree 88 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[0] > 0.5) << 2) | ((features[13] > 0.521164059638977) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.029071; scores[1] += 0.013999; scores[2] += 0.015072; break;
      case 1: scores[0] += 0.035041; scores[1] += -0.021581; scores[2] += -0.013460; break;
      case 2: scores[0] += -0.008878; scores[1] += 0.038462; scores[2] += -0.029583; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.023658; scores[1] += -0.036604; scores[2] += 0.012946; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.009382; scores[1] += 0.028906; scores[2] += -0.019523; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.004773; scores[1] += 0.000121; scores[2] += -0.004895; break;
      case 9: scores[0] += 0.022832; scores[1] += -0.013777; scores[2] += -0.009055; break;
      case 10: scores[0] += -0.027804; scores[1] += 0.033016; scores[2] += -0.005212; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.062137; scores[1] += 0.003230; scores[2] += -0.065367; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 89 (depth=4)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[34] > 0.44999998807907104) << 1) | ((features[10] > 6.2916669845581055) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.014960; scores[1] += 0.006006; scores[2] += -0.020967; break;
      case 1: scores[0] += -0.005537; scores[1] += 0.028372; scores[2] += -0.022835; break;
      case 2: scores[0] += -0.001517; scores[1] += 0.009565; scores[2] += -0.008049; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.006877; scores[1] += -0.000508; scores[2] += 0.007385; break;
      case 5: scores[0] += -0.033001; scores[1] += 0.040403; scores[2] += -0.007403; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.021498; scores[1] += -0.031722; scores[2] += 0.010224; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.004584; scores[1] += -0.010224; scores[2] += 0.014808; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.026961; scores[1] += -0.030828; scores[2] += 0.003866; break;
      case 13: scores[0] += 0.013142; scores[1] += -0.005757; scores[2] += -0.007384; break;
      case 14: scores[0] += -0.005102; scores[1] += 0.046001; scores[2] += -0.040899; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 90 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 10.416666030883789) << 2) | ((features[11] > 0.029857397079467773) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002325; scores[1] += -0.001566; scores[2] += 0.003890; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.014192; scores[1] += 0.024282; scores[2] += -0.038474; break;
      case 3: scores[0] += 0.038423; scores[1] += -0.023737; scores[2] += -0.014687; break;
      case 4: scores[0] += -0.006466; scores[1] += 0.032202; scores[2] += -0.025736; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000477; scores[1] += 0.002045; scores[2] += -0.001568; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.061858; scores[1] += -0.017943; scores[2] += -0.043915; break;
      case 11: scores[0] += -0.031513; scores[1] += 0.001923; scores[2] += 0.029590; break;
      case 12: scores[0] += 0.021058; scores[1] += -0.041274; scores[2] += 0.020216; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.039434; scores[1] += 0.078983; scores[2] += -0.039549; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 91 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[43] > 0.5346320867538452) << 1) | ((features[10] > 7.633333206176758) << 2) | ((features[44] > 0.44999998807907104) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.027241; scores[1] += 0.014350; scores[2] += 0.012892; break;
      case 1: scores[0] += 0.039284; scores[1] += -0.023873; scores[2] += -0.015412; break;
      case 2: scores[0] += 0.017297; scores[1] += -0.001293; scores[2] += -0.016004; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.004163; scores[1] += -0.005775; scores[2] += 0.001611; break;
      case 5: scores[0] += 0.014805; scores[1] += -0.009118; scores[2] += -0.005687; break;
      case 6: scores[0] += -0.017379; scores[1] += 0.027113; scores[2] += -0.009734; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.015887; scores[1] += 0.044977; scores[2] += -0.029090; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.006591; scores[1] += -0.021519; scores[2] += 0.028109; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002043; scores[1] += 0.014516; scores[2] += -0.012473; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.019419; scores[1] += 0.044758; scores[2] += -0.025339; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 92 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[11] > 0.1558704376220703) << 1) | ((features[13] > 0.527046799659729) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002067; scores[1] += -0.007203; scores[2] += 0.009270; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.047684; scores[1] += 0.000424; scores[2] += -0.048108; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.004014; scores[1] += -0.002330; scores[2] += -0.001684; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.004134; scores[1] += -0.014173; scores[2] += 0.018307; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.032470; scores[1] += 0.015414; scores[2] += 0.017055; break;
      case 9: scores[0] += 0.033301; scores[1] += -0.020418; scores[2] += -0.012883; break;
      case 10: scores[0] += -0.012948; scores[1] += 0.029652; scores[2] += -0.016704; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.004804; scores[1] += 0.007890; scores[2] += -0.012694; break;
      case 13: scores[0] += 0.021617; scores[1] += -0.013198; scores[2] += -0.008419; break;
      case 14: scores[0] += 0.036503; scores[1] += -0.023248; scores[2] += -0.013255; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 93 (depth=4)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[13] > 0.5872211456298828) << 2) | ((features[11] > 0.026671409606933594) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.026082; scores[1] += 0.013248; scores[2] += 0.012834; break;
      case 1: scores[0] += 0.043252; scores[1] += -0.009572; scores[2] += -0.033680; break;
      case 2: scores[0] += 0.014603; scores[1] += 0.020641; scores[2] += -0.035244; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.006373; scores[1] += -0.012280; scores[2] += 0.005907; break;
      case 5: scores[0] += -0.002850; scores[1] += 0.008277; scores[2] += -0.005427; break;
      case 6: scores[0] += -0.015557; scores[1] += 0.034032; scores[2] += -0.018475; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.016918; scores[1] += 0.004252; scores[2] += 0.012666; break;
      case 9: scores[0] += 0.025645; scores[1] += -0.017268; scores[2] += -0.008378; break;
      case 10: scores[0] += 0.026417; scores[1] += -0.054865; scores[2] += 0.028447; break;
      case 11: scores[0] += -0.037308; scores[1] += 0.074346; scores[2] += -0.037038; break;
      case 12: scores[0] += 0.021445; scores[1] += 0.018201; scores[2] += -0.039646; break;
      case 13: scores[0] += -0.006417; scores[1] += -0.013253; scores[2] += 0.019670; break;
      case 14: scores[0] += 0.010691; scores[1] += -0.003986; scores[2] += -0.006705; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 94 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1835016906261444) << 0) | ((features[9] > 2.5) << 1) | ((features[19] > 0.5) << 2) | ((features[43] > 0.23669467866420746) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003587; scores[1] += -0.005635; scores[2] += 0.009221; break;
      case 1: scores[0] += 0.043828; scores[1] += -0.010227; scores[2] += -0.033601; break;
      case 2: scores[0] += -0.003890; scores[1] += 0.007311; scores[2] += -0.003421; break;
      case 3: scores[0] += -0.006830; scores[1] += 0.046536; scores[2] += -0.039706; break;
      case 4: scores[0] += 0.036650; scores[1] += -0.045153; scores[2] += 0.008502; break;
      case 5: scores[0] += 0.018812; scores[1] += 0.000008; scores[2] += -0.018820; break;
      case 6: scores[0] += 0.004366; scores[1] += 0.005944; scores[2] += -0.010310; break;
      case 7: scores[0] += -0.020536; scores[1] += 0.007738; scores[2] += 0.012798; break;
      case 8: scores[0] += -0.002376; scores[1] += 0.002085; scores[2] += 0.000291; break;
      case 9: scores[0] += -0.007776; scores[1] += -0.008685; scores[2] += 0.016461; break;
      case 10: scores[0] += -0.035592; scores[1] += -0.002550; scores[2] += 0.038142; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.003948; scores[1] += -0.002295; scores[2] += 0.006243; break;
      case 13: scores[0] += -0.002095; scores[1] += 0.012508; scores[2] += -0.010413; break;
      case 14: scores[0] += -0.006314; scores[1] += 0.000850; scores[2] += 0.005464; break;
      case 15: scores[0] += -0.002692; scores[1] += -0.002266; scores[2] += 0.004958; break;
    }
  }

  // Tree 95 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[0] > 0.5) << 1) | ((features[13] > 0.527046799659729) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000769; scores[1] += 0.008149; scores[2] += -0.007380; break;
      case 1: scores[0] += 0.004334; scores[1] += -0.064158; scores[2] += 0.059824; break;
      case 2: scores[0] += 0.016186; scores[1] += -0.028940; scores[2] += 0.012754; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.001366; scores[1] += 0.021412; scores[2] += -0.020046; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.045243; scores[1] += 0.035467; scores[2] += 0.009777; break;
      case 9: scores[0] += -0.036051; scores[1] += 0.003009; scores[2] += 0.033041; break;
      case 10: scores[0] += -0.000491; scores[1] += 0.011329; scores[2] += -0.010838; break;
      case 11: scores[0] += 0.018601; scores[1] += -0.016731; scores[2] += -0.001870; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.006687; scores[1] += -0.003980; scores[2] += -0.002707; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.055961; scores[1] += 0.005014; scores[2] += -0.060975; break;
    }
  }

  // Tree 96 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[25] > 0.5) << 1) | ((features[44] > 0.25) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.016467; scores[1] += -0.026733; scores[2] += 0.010266; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.003092; scores[1] += 0.014873; scores[2] += -0.011781; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.035048; scores[1] += 0.044037; scores[2] += -0.008990; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.006809; scores[1] += -0.019355; scores[2] += 0.026164; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.026741; scores[1] += -0.016562; scores[2] += -0.010179; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.011557; scores[1] += -0.011782; scores[2] += 0.000225; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000751; scores[1] += -0.021394; scores[2] += 0.022146; break;
      case 13: scores[0] += -0.003228; scores[1] += -0.024488; scores[2] += 0.027717; break;
      case 14: scores[0] += -0.003972; scores[1] += 0.006136; scores[2] += -0.002164; break;
      case 15: scores[0] += -0.006642; scores[1] += 0.052522; scores[2] += -0.045880; break;
    }
  }

  // Tree 97 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[9] > 2.5) << 1) | ((features[35] > 0.5) << 2) | ((features[13] > 0.03279569745063782) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.012530; scores[1] += -0.010843; scores[2] += -0.001687; break;
      case 1: scores[0] += 0.033159; scores[1] += -0.007121; scores[2] += -0.026038; break;
      case 2: scores[0] += -0.001534; scores[1] += 0.008589; scores[2] += -0.007056; break;
      case 3: scores[0] += -0.021770; scores[1] += 0.028451; scores[2] += -0.006681; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.025836; scores[1] += -0.025248; scores[2] += 0.051084; break;
      case 6: scores[0] += -0.000123; scores[1] += 0.000561; scores[2] += -0.000438; break;
      case 7: scores[0] += -0.029619; scores[1] += 0.025566; scores[2] += 0.004053; break;
      case 8: scores[0] += -0.036467; scores[1] += 0.035580; scores[2] += 0.000887; break;
      case 9: scores[0] += 0.006588; scores[1] += -0.003057; scores[2] += -0.003531; break;
      case 10: scores[0] += -0.008826; scores[1] += 0.033208; scores[2] += -0.024382; break;
      case 11: scores[0] += 0.005142; scores[1] += -0.013580; scores[2] += 0.008438; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.009184; scores[1] += 0.018243; scores[2] += -0.009059; break;
      case 14: scores[0] += -0.000182; scores[1] += 0.002259; scores[2] += -0.002076; break;
      case 15: scores[0] += -0.021983; scores[1] += 0.027586; scores[2] += -0.005602; break;
    }
  }

  // Tree 98 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[43] > 0.4759725332260132) << 1) | ((features[23] > 0.5) << 2) | ((features[26] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001294; scores[1] += -0.006177; scores[2] += 0.004883; break;
      case 1: scores[0] += 0.042785; scores[1] += -0.025055; scores[2] += -0.017730; break;
      case 2: scores[0] += 0.003777; scores[1] += 0.006995; scores[2] += -0.010772; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.020195; scores[1] += 0.052986; scores[2] += -0.032791; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000731; scores[1] += 0.003317; scores[2] += -0.002586; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.022269; scores[1] += 0.035436; scores[2] += -0.013167; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.006307; scores[1] += 0.015753; scores[2] += -0.009446; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 99 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[13] > 0.5178799629211426) << 2) | ((features[10] > 8.100000381469727) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.014132; scores[1] += 0.009409; scores[2] += 0.004723; break;
      case 1: scores[0] += -0.017684; scores[1] += 0.044845; scores[2] += -0.027161; break;
      case 2: scores[0] += -0.021681; scores[1] += 0.001218; scores[2] += 0.020463; break;
      case 3: scores[0] += -0.006184; scores[1] += -0.029872; scores[2] += 0.036056; break;
      case 4: scores[0] += 0.006906; scores[1] += -0.002788; scores[2] += -0.004118; break;
      case 5: scores[0] += -0.008984; scores[1] += 0.021522; scores[2] += -0.012539; break;
      case 6: scores[0] += -0.003569; scores[1] += 0.014037; scores[2] += -0.010468; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.023333; scores[1] += 0.004806; scores[2] += 0.018527; break;
      case 9: scores[0] += 0.014504; scores[1] += -0.007697; scores[2] += -0.006807; break;
      case 10: scores[0] += 0.026146; scores[1] += -0.024848; scores[2] += -0.001298; break;
      case 11: scores[0] += -0.005335; scores[1] += -0.009282; scores[2] += 0.014617; break;
      case 12: scores[0] += 0.000107; scores[1] += 0.004265; scores[2] += -0.004372; break;
      case 13: scores[0] += 0.007038; scores[1] += -0.008774; scores[2] += 0.001736; break;
      case 14: scores[0] += 0.057545; scores[1] += -0.003639; scores[2] += -0.053906; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 100 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[10] > 7.224999904632568) << 1) | ((features[43] > 0.14907407760620117) << 2) | ((features[13] > 0.8973684310913086) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005457; scores[1] += 0.017105; scores[2] += -0.011647; break;
      case 1: scores[0] += 0.036753; scores[1] += -0.021652; scores[2] += -0.015101; break;
      case 2: scores[0] += 0.000774; scores[1] += -0.005582; scores[2] += 0.004808; break;
      case 3: scores[0] += 0.013040; scores[1] += -0.008020; scores[2] += -0.005020; break;
      case 4: scores[0] += -0.039978; scores[1] += 0.002713; scores[2] += 0.037265; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.024790; scores[1] += 0.021874; scores[2] += 0.002916; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.023346; scores[1] += 0.039683; scores[2] += -0.016338; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.027495; scores[1] += 0.017438; scores[2] += -0.044933; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.017412; scores[1] += 0.004302; scores[2] += -0.021714; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.041208; scores[1] += -0.002451; scores[2] += 0.043659; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 101 (depth=4)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[43] > 0.23904761672019958) << 1) | ((features[13] > 0.5370879173278809) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.013096; scores[1] += 0.009661; scores[2] += 0.003434; break;
      case 1: scores[0] += -0.009916; scores[1] += 0.011949; scores[2] += -0.002033; break;
      case 2: scores[0] += -0.035678; scores[1] += -0.008573; scores[2] += 0.044252; break;
      case 3: scores[0] += -0.003788; scores[1] += 0.023877; scores[2] += -0.020089; break;
      case 4: scores[0] += 0.011752; scores[1] += 0.008115; scores[2] += -0.019867; break;
      case 5: scores[0] += 0.003323; scores[1] += -0.018293; scores[2] += 0.014969; break;
      case 6: scores[0] += -0.004120; scores[1] += 0.000832; scores[2] += 0.003288; break;
      case 7: scores[0] += -0.008978; scores[1] += -0.018757; scores[2] += 0.027734; break;
      case 8: scores[0] += 0.042183; scores[1] += -0.016027; scores[2] += -0.026157; break;
      case 9: scores[0] += 0.005711; scores[1] += -0.032986; scores[2] += 0.027275; break;
      case 10: scores[0] += -0.001450; scores[1] += -0.003440; scores[2] += 0.004890; break;
      case 11: scores[0] += -0.004852; scores[1] += -0.002899; scores[2] += 0.007751; break;
      case 12: scores[0] += -0.008342; scores[1] += 0.025507; scores[2] += -0.017165; break;
      case 13: scores[0] += 0.053158; scores[1] += -0.012627; scores[2] += -0.040531; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 102 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[34] > 0.15000000596046448) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000864; scores[1] += 0.003981; scores[2] += -0.003118; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.032468; scores[1] += 0.006952; scores[2] += 0.025517; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.002630; scores[1] += 0.004502; scores[2] += -0.001872; break;
      case 5: scores[0] += 0.028656; scores[1] += -0.049777; scores[2] += 0.021121; break;
      case 6: scores[0] += -0.007656; scores[1] += 0.037895; scores[2] += -0.030239; break;
      case 7: scores[0] += -0.005301; scores[1] += 0.041924; scores[2] += -0.036622; break;
      case 8: scores[0] += 0.019512; scores[1] += -0.035540; scores[2] += 0.016028; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.009531; scores[1] += -0.004139; scores[2] += 0.013670; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.054884; scores[1] += -0.002478; scores[2] += -0.052406; break;
      case 13: scores[0] += -0.021193; scores[1] += -0.009867; scores[2] += 0.031061; break;
      case 14: scores[0] += -0.006267; scores[1] += 0.032233; scores[2] += -0.025966; break;
      case 15: scores[0] += -0.004739; scores[1] += 0.012404; scores[2] += -0.007665; break;
    }
  }

  // Tree 103 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[10] > 4.099999904632568) << 1) | ((features[13] > 0.42206478118896484) << 2) | ((features[13] > 0.41801074147224426) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010616; scores[1] += 0.005009; scores[2] += -0.015626; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.008006; scores[1] += 0.008787; scores[2] += -0.000781; break;
      case 3: scores[0] += 0.013707; scores[1] += -0.009315; scores[2] += -0.004391; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.003398; scores[1] += 0.047923; scores[2] += -0.044524; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.033824; scores[1] += 0.039383; scores[2] += -0.005559; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.004080; scores[1] += -0.012159; scores[2] += 0.008079; break;
      case 15: scores[0] += 0.034357; scores[1] += -0.019695; scores[2] += -0.014662; break;
    }
  }

  // Tree 104 (depth=4)
  {
    const leafIdx = ((features[10] > 4.633333206176758) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[44] > 0.25) << 2) | ((features[10] > 11.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.012733; scores[1] += -0.011084; scores[2] += -0.001650; break;
      case 1: scores[0] += 0.007780; scores[1] += -0.013301; scores[2] += 0.005521; break;
      case 2: scores[0] += -0.037082; scores[1] += 0.023094; scores[2] += 0.013988; break;
      case 3: scores[0] += 0.053470; scores[1] += -0.036618; scores[2] += -0.016852; break;
      case 4: scores[0] += -0.006873; scores[1] += 0.029433; scores[2] += -0.022560; break;
      case 5: scores[0] += -0.003836; scores[1] += 0.002624; scores[2] += 0.001212; break;
      case 6: scores[0] += -0.015425; scores[1] += 0.026955; scores[2] += -0.011530; break;
      case 7: scores[0] += -0.006748; scores[1] += 0.010049; scores[2] += -0.003301; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000772; scores[1] += 0.004108; scores[2] += -0.004880; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.026185; scores[1] += 0.042610; scores[2] += -0.016425; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.031827; scores[1] += 0.016772; scores[2] += 0.015055; break;
    }
  }

  // Tree 105 (depth=4)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[10] > 4.900000095367432) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.012584; scores[1] += -0.010942; scores[2] += -0.001642; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.035603; scores[1] += 0.021799; scores[2] += 0.013804; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.008861; scores[1] += -0.009912; scores[2] += 0.001051; break;
      case 5: scores[0] += -0.011701; scores[1] += 0.016988; scores[2] += -0.005288; break;
      case 6: scores[0] += 0.025784; scores[1] += -0.048671; scores[2] += 0.022886; break;
      case 7: scores[0] += -0.016492; scores[1] += 0.032910; scores[2] += -0.016418; break;
      case 8: scores[0] += -0.007117; scores[1] += 0.014358; scores[2] += -0.007242; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.018731; scores[1] += 0.030639; scores[2] += -0.011908; break;
      case 11: scores[0] += -0.001855; scores[1] += 0.010706; scores[2] += -0.008851; break;
      case 12: scores[0] += -0.002802; scores[1] += 0.007463; scores[2] += -0.004661; break;
      case 13: scores[0] += -0.000229; scores[1] += 0.002087; scores[2] += -0.001858; break;
      case 14: scores[0] += -0.026101; scores[1] += -0.005613; scores[2] += 0.031714; break;
      case 15: scores[0] += -0.004250; scores[1] += 0.019179; scores[2] += -0.014929; break;
    }
  }

  // Tree 106 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[13] > 0.2679487466812134) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.015230; scores[1] += 0.007942; scores[2] += -0.023172; break;
      case 1: scores[0] += -0.017954; scores[1] += -0.010186; scores[2] += 0.028140; break;
      case 2: scores[0] += -0.041848; scores[1] += -0.001092; scores[2] += 0.042940; break;
      case 3: scores[0] += -0.001500; scores[1] += 0.020220; scores[2] += -0.018720; break;
      case 4: scores[0] += 0.000378; scores[1] += -0.000432; scores[2] += 0.000054; break;
      case 5: scores[0] += 0.037607; scores[1] += -0.052025; scores[2] += 0.014418; break;
      case 6: scores[0] += -0.013063; scores[1] += 0.023408; scores[2] += -0.010344; break;
      case 7: scores[0] += -0.005255; scores[1] += 0.025671; scores[2] += -0.020416; break;
      case 8: scores[0] += -0.022668; scores[1] += 0.023506; scores[2] += -0.000838; break;
      case 9: scores[0] += -0.006226; scores[1] += -0.026438; scores[2] += 0.032664; break;
      case 10: scores[0] += -0.002199; scores[1] += 0.015156; scores[2] += -0.012957; break;
      case 11: scores[0] += -0.003042; scores[1] += 0.011789; scores[2] += -0.008747; break;
      case 12: scores[0] += 0.003335; scores[1] += -0.018604; scores[2] += 0.015269; break;
      case 13: scores[0] += -0.006973; scores[1] += 0.011946; scores[2] += -0.004972; break;
      case 14: scores[0] += -0.006614; scores[1] += 0.000007; scores[2] += 0.006607; break;
      case 15: scores[0] += -0.000804; scores[1] += 0.016511; scores[2] += -0.015707; break;
    }
  }

  // Tree 107 (depth=4)
  {
    const leafIdx = ((features[43] > 0.1558704376220703) << 0) | ((features[43] > 0.3603896200656891) << 1) | ((features[13] > 0.9354166984558105) << 2) | ((features[10] > 7.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008151; scores[1] += 0.009075; scores[2] += -0.017226; break;
      case 1: scores[0] += -0.015822; scores[1] += -0.010690; scores[2] += 0.026512; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.016445; scores[1] += 0.018370; scores[2] += -0.001925; break;
      case 4: scores[0] += -0.020629; scores[1] += 0.034255; scores[2] += -0.013626; break;
      case 5: scores[0] += -0.010797; scores[1] += 0.035124; scores[2] += -0.024327; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.014777; scores[1] += 0.000295; scores[2] += -0.015072; break;
      case 8: scores[0] += 0.002686; scores[1] += -0.007104; scores[2] += 0.004418; break;
      case 9: scores[0] += -0.030083; scores[1] += 0.031679; scores[2] += -0.001596; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.014600; scores[1] += 0.022049; scores[2] += -0.007449; break;
      case 12: scores[0] += 0.022692; scores[1] += 0.019954; scores[2] += -0.042645; break;
      case 13: scores[0] += -0.011135; scores[1] += -0.055588; scores[2] += 0.066723; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.026843; scores[1] += 0.015097; scores[2] += 0.011747; break;
    }
  }

  // Tree 108 (depth=4)
  {
    const leafIdx = ((features[13] > 0.39208072423934937) << 0) | ((features[13] > 0.5166851878166199) << 1) | ((features[14] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004867; scores[1] += 0.002438; scores[2] += -0.007305; break;
      case 1: scores[0] += -0.003970; scores[1] += -0.034055; scores[2] += 0.038025; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.019398; scores[1] += 0.040257; scores[2] += -0.020859; break;
      case 4: scores[0] += -0.027772; scores[1] += 0.026895; scores[2] += 0.000878; break;
      case 5: scores[0] += -0.021498; scores[1] += -0.051264; scores[2] += 0.072762; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.032999; scores[1] += -0.044309; scores[2] += 0.011310; break;
      case 8: scores[0] += 0.004563; scores[1] += -0.017164; scores[2] += 0.012601; break;
      case 9: scores[0] += 0.012736; scores[1] += -0.061711; scores[2] += 0.048975; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.033249; scores[1] += -0.046437; scores[2] += 0.013188; break;
      case 12: scores[0] += -0.010900; scores[1] += 0.017836; scores[2] += -0.006937; break;
      case 13: scores[0] += -0.022944; scores[1] += 0.023651; scores[2] += -0.000706; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.003734; scores[1] += 0.003723; scores[2] += -0.007457; break;
    }
  }

  // Tree 109 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5285947918891907) << 0) | ((features[0] > 0.5) << 1) | ((features[14] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000555; scores[1] += 0.001400; scores[2] += -0.000845; break;
      case 1: scores[0] += -0.012980; scores[1] += 0.043694; scores[2] += -0.030715; break;
      case 2: scores[0] += 0.017158; scores[1] += -0.034719; scores[2] += 0.017561; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.041574; scores[1] += 0.001493; scores[2] += 0.040081; break;
      case 5: scores[0] += 0.033213; scores[1] += -0.038730; scores[2] += 0.005517; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.005611; scores[1] += -0.056389; scores[2] += 0.050777; break;
      case 9: scores[0] += 0.033049; scores[1] += -0.042834; scores[2] += 0.009784; break;
      case 10: scores[0] += 0.005574; scores[1] += -0.014477; scores[2] += 0.008904; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.040485; scores[1] += 0.032191; scores[2] += 0.008294; break;
      case 13: scores[0] += -0.000574; scores[1] += 0.002400; scores[2] += -0.001826; break;
      case 14: scores[0] += 0.010447; scores[1] += -0.000509; scores[2] += -0.009938; break;
      case 15: scores[0] += 0.046562; scores[1] += 0.007783; scores[2] += -0.054345; break;
    }
  }

  // Tree 110 (depth=4)
  {
    const leafIdx = ((features[10] > 6.550000190734863) << 0) | ((features[13] > 0.3623737394809723) << 1) | ((features[10] > 8.708333969116211) << 2) | ((features[13] > 0.9298029541969299) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004291; scores[1] += 0.004616; scores[2] += -0.000325; break;
      case 1: scores[0] += -0.013118; scores[1] += 0.018685; scores[2] += -0.005567; break;
      case 2: scores[0] += 0.022639; scores[1] += 0.000887; scores[2] += -0.023526; break;
      case 3: scores[0] += -0.029688; scores[1] += -0.004611; scores[2] += 0.034299; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.004367; scores[1] += -0.009407; scores[2] += 0.005040; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.003183; scores[1] += -0.003051; scores[2] += -0.000132; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.009046; scores[1] += 0.013254; scores[2] += -0.022300; break;
      case 11: scores[0] += 0.020067; scores[1] += -0.037853; scores[2] += 0.017785; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.001751; scores[1] += 0.011714; scores[2] += -0.013465; break;
    }
  }

  // Tree 111 (depth=4)
  {
    const leafIdx = ((features[43] > 0.20942983031272888) << 0) | ((features[13] > 0.2124060094356537) << 1) | ((features[30] > 0.5) << 2) | ((features[10] > 9.708333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002459; scores[1] += 0.014313; scores[2] += -0.011853; break;
      case 1: scores[0] += -0.000225; scores[1] += 0.003689; scores[2] += -0.003464; break;
      case 2: scores[0] += 0.015043; scores[1] += -0.036754; scores[2] += 0.021710; break;
      case 3: scores[0] += -0.003233; scores[1] += 0.021293; scores[2] += -0.018059; break;
      case 4: scores[0] += -0.023659; scores[1] += -0.022660; scores[2] += 0.046319; break;
      case 5: scores[0] += -0.000527; scores[1] += -0.028440; scores[2] += 0.028966; break;
      case 6: scores[0] += 0.009947; scores[1] += 0.014581; scores[2] += -0.024528; break;
      case 7: scores[0] += -0.014354; scores[1] += -0.008461; scores[2] += 0.022815; break;
      case 8: scores[0] += 0.008174; scores[1] += -0.018042; scores[2] += 0.009868; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000277; scores[1] += 0.015310; scores[2] += -0.015587; break;
      case 11: scores[0] += -0.016187; scores[1] += 0.035131; scores[2] += -0.018944; break;
      case 12: scores[0] += 0.015745; scores[1] += -0.025350; scores[2] += 0.009605; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.008914; scores[1] += -0.006349; scores[2] += -0.002564; break;
      case 15: scores[0] += -0.012895; scores[1] += -0.013500; scores[2] += 0.026395; break;
    }
  }

  // Tree 112 (depth=4)
  {
    const leafIdx = ((features[13] > 0.13714733719825745) << 0) | ((features[10] > 12.833333969116211) << 1) | ((features[34] > 0.25) << 2) | ((features[10] > 10.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.022649; scores[1] += 0.017512; scores[2] += 0.005137; break;
      case 1: scores[0] += 0.004600; scores[1] += -0.009053; scores[2] += 0.004452; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.036031; scores[1] += -0.030399; scores[2] += -0.005632; break;
      case 5: scores[0] += 0.017340; scores[1] += 0.003509; scores[2] += -0.020849; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000393; scores[1] += -0.004349; scores[2] += 0.004742; break;
      case 9: scores[0] += 0.000750; scores[1] += -0.000171; scores[2] += -0.000580; break;
      case 10: scores[0] += 0.023418; scores[1] += -0.012168; scores[2] += -0.011250; break;
      case 11: scores[0] += -0.019597; scores[1] += 0.027359; scores[2] += -0.007762; break;
      case 12: scores[0] += -0.023895; scores[1] += 0.058151; scores[2] += -0.034256; break;
      case 13: scores[0] += -0.007134; scores[1] += 0.020146; scores[2] += -0.013012; break;
      case 14: scores[0] += -0.007577; scores[1] += -0.005252; scores[2] += 0.012830; break;
      case 15: scores[0] += -0.007134; scores[1] += 0.020146; scores[2] += -0.013012; break;
    }
  }

  // Tree 113 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[13] > 0.9183333516120911) << 1) | ((features[13] > 0.8198052048683167) << 2) | ((features[43] > 0.10818713903427124) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.011195; scores[1] += 0.000963; scores[2] += -0.012158; break;
      case 1: scores[0] += -0.001791; scores[1] += -0.000198; scores[2] += 0.001989; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.054406; scores[1] += 0.003791; scores[2] += -0.058197; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.021932; scores[1] += 0.021261; scores[2] += -0.043193; break;
      case 8: scores[0] += -0.001596; scores[1] += 0.009941; scores[2] += -0.008344; break;
      case 9: scores[0] += -0.034615; scores[1] += 0.010614; scores[2] += 0.024001; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.036212; scores[1] += 0.051259; scores[2] += -0.015047; break;
      case 14: scores[0] += -0.031248; scores[1] += 0.033037; scores[2] += -0.001788; break;
      case 15: scores[0] += 0.004900; scores[1] += -0.022418; scores[2] += 0.017518; break;
    }
  }

  // Tree 114 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[11] > 0.14760348200798035) << 2) | ((features[10] > 5.366666793823242) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.016598; scores[1] += 0.002128; scores[2] += -0.018726; break;
      case 1: scores[0] += 0.008213; scores[1] += -0.004730; scores[2] += -0.003482; break;
      case 2: scores[0] += 0.000758; scores[1] += 0.013189; scores[2] += -0.013948; break;
      case 3: scores[0] += -0.005817; scores[1] += 0.020578; scores[2] += -0.014761; break;
      case 4: scores[0] += -0.004258; scores[1] += 0.016046; scores[2] += -0.011788; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001748; scores[1] += 0.013495; scores[2] += -0.011748; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.005682; scores[1] += -0.000218; scores[2] += 0.005900; break;
      case 9: scores[0] += -0.000607; scores[1] += -0.048007; scores[2] += 0.048614; break;
      case 10: scores[0] += -0.002910; scores[1] += 0.010393; scores[2] += -0.007483; break;
      case 11: scores[0] += -0.000081; scores[1] += 0.001919; scores[2] += -0.001838; break;
      case 12: scores[0] += 0.032328; scores[1] += 0.004387; scores[2] += -0.036715; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.013934; scores[1] += -0.057174; scores[2] += 0.043239; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 115 (depth=4)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[13] > 0.8918128609657288) << 1) | ((features[13] > 0.9183333516120911) << 2) | ((features[10] > 10.833333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006977; scores[1] += -0.005508; scores[2] += 0.012485; break;
      case 1: scores[0] += -0.005804; scores[1] += 0.002702; scores[2] += 0.003102; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.027293; scores[1] += 0.062374; scores[2] += -0.035081; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.014252; scores[1] += -0.017654; scores[2] += 0.003401; break;
      case 7: scores[0] += 0.012532; scores[1] += -0.000353; scores[2] += -0.012179; break;
      case 8: scores[0] += 0.011721; scores[1] += -0.003099; scores[2] += -0.008622; break;
      case 9: scores[0] += -0.023233; scores[1] += 0.023905; scores[2] += -0.000672; break;
      case 10: scores[0] += 0.001248; scores[1] += -0.000860; scores[2] += -0.000389; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002274; scores[1] += 0.006171; scores[2] += -0.003897; break;
      case 15: scores[0] += -0.042729; scores[1] += 0.049141; scores[2] += -0.006411; break;
    }
  }

  // Tree 116 (depth=4)
  {
    const leafIdx = ((features[10] > 5.550000190734863) << 0) | ((features[27] > 0.5) << 1) | ((features[13] > 0.42206478118896484) << 2) | ((features[13] > 0.4202037453651428) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007735; scores[1] += 0.013528; scores[2] += -0.021263; break;
      case 1: scores[0] += -0.005585; scores[1] += 0.005457; scores[2] += 0.000128; break;
      case 2: scores[0] += -0.000143; scores[1] += -0.004495; scores[2] += 0.004638; break;
      case 3: scores[0] += -0.000437; scores[1] += -0.012651; scores[2] += 0.013087; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += -0.003099; scores[1] += 0.047176; scores[2] += -0.044077; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.009161; scores[1] += 0.004577; scores[2] += -0.013738; break;
      case 13: scores[0] += -0.000734; scores[1] += -0.006845; scores[2] += 0.007579; break;
      case 14: scores[0] += 0.004387; scores[1] += 0.016037; scores[2] += -0.020424; break;
      case 15: scores[0] += -0.000312; scores[1] += -0.042291; scores[2] += 0.042603; break;
    }
  }

  // Tree 117 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[30] > 0.5) << 2) | ((features[11] > 0.06155303120613098) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002617; scores[1] += -0.001344; scores[2] += 0.003961; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.016016; scores[1] += 0.029974; scores[2] += -0.013958; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.020721; scores[1] += 0.037620; scores[2] += -0.016899; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001607; scores[1] += -0.043916; scores[2] += 0.045523; break;
      case 7: scores[0] += 0.002376; scores[1] += 0.008066; scores[2] += -0.010441; break;
      case 8: scores[0] += 0.015464; scores[1] += -0.001187; scores[2] += -0.014277; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000853; scores[1] += 0.007610; scores[2] += -0.008463; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.031612; scores[1] += -0.047775; scores[2] += 0.016164; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.040549; scores[1] += 0.041517; scores[2] += -0.000968; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 118 (depth=4)
  {
    const leafIdx = ((features[43] > 0.15894736349582672) << 0) | ((features[43] > 0.16333332657814026) << 1) | ((features[29] > 0.5) << 2) | ((features[11] > 0.05480480566620827) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000794; scores[1] += 0.001191; scores[2] += -0.000396; break;
      case 1: scores[0] += -0.005420; scores[1] += 0.018466; scores[2] += -0.013046; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.005901; scores[1] += 0.000598; scores[2] += 0.005303; break;
      case 4: scores[0] += -0.022186; scores[1] += 0.033733; scores[2] += -0.011547; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.008616; scores[1] += -0.025215; scores[2] += 0.033831; break;
      case 8: scores[0] += 0.018692; scores[1] += -0.011887; scores[2] += -0.006805; break;
      case 9: scores[0] += -0.024776; scores[1] += -0.011970; scores[2] += 0.036746; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.028983; scores[1] += 0.045851; scores[2] += -0.016868; break;
      case 12: scores[0] += -0.006683; scores[1] += -0.003643; scores[2] += 0.010326; break;
      case 13: scores[0] += -0.000721; scores[1] += -0.000679; scores[2] += 0.001401; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.010331; scores[1] += -0.011163; scores[2] += 0.021495; break;
    }
  }

  // Tree 119 (depth=4)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[33] > 0.5) << 1) | ((features[22] > 0.5) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004788; scores[1] += -0.009218; scores[2] += 0.004430; break;
      case 1: scores[0] += 0.037409; scores[1] += -0.024443; scores[2] += -0.012965; break;
      case 2: scores[0] += 0.010527; scores[1] += -0.024371; scores[2] += 0.013844; break;
      case 3: scores[0] += -0.026344; scores[1] += -0.023769; scores[2] += 0.050113; break;
      case 4: scores[0] += -0.001295; scores[1] += 0.007093; scores[2] += -0.005798; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003596; scores[1] += 0.041326; scores[2] += -0.037730; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.003298; scores[1] += 0.002949; scores[2] += -0.006247; break;
      case 9: scores[0] += -0.035597; scores[1] += 0.022085; scores[2] += 0.013512; break;
      case 10: scores[0] += -0.008036; scores[1] += 0.019621; scores[2] += -0.011585; break;
      case 11: scores[0] += 0.031056; scores[1] += -0.034711; scores[2] += 0.003656; break;
      case 12: scores[0] += -0.041933; scores[1] += 0.018066; scores[2] += 0.023867; break;
      case 13: scores[0] += 0.021374; scores[1] += -0.028667; scores[2] += 0.007293; break;
      case 14: scores[0] += -0.000482; scores[1] += 0.017985; scores[2] += -0.017503; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 120 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[13] > 0.22474747896194458) << 1) | ((features[43] > 0.20942983031272888) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005869; scores[1] += 0.003521; scores[2] += -0.009390; break;
      case 1: scores[0] += -0.023180; scores[1] += -0.003264; scores[2] += 0.026445; break;
      case 2: scores[0] += 0.000308; scores[1] += -0.008187; scores[2] += 0.007880; break;
      case 3: scores[0] += 0.023051; scores[1] += -0.019587; scores[2] += -0.003464; break;
      case 4: scores[0] += 0.002338; scores[1] += -0.015490; scores[2] += 0.013153; break;
      case 5: scores[0] += -0.000398; scores[1] += -0.038028; scores[2] += 0.038426; break;
      case 6: scores[0] += -0.003305; scores[1] += -0.003117; scores[2] += 0.006423; break;
      case 7: scores[0] += -0.002086; scores[1] += 0.030817; scores[2] += -0.028731; break;
      case 8: scores[0] += -0.023333; scores[1] += -0.009684; scores[2] += 0.033017; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.010045; scores[1] += 0.010404; scores[2] += -0.020449; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001826; scores[1] += -0.001263; scores[2] += 0.003089; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.042388; scores[1] += 0.017477; scores[2] += 0.024911; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 121 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 6.366666793823242) << 1) | ((features[44] > 0.15000000596046448) << 2) | ((features[13] > 0.8198052048683167) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.029011; scores[1] += -0.023341; scores[2] += -0.005670; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.028575; scores[1] += -0.022581; scores[2] += -0.005995; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.006251; scores[1] += 0.008267; scores[2] += -0.014518; break;
      case 5: scores[0] += -0.005790; scores[1] += -0.001734; scores[2] += 0.007524; break;
      case 6: scores[0] += -0.022486; scores[1] += 0.006824; scores[2] += 0.015662; break;
      case 7: scores[0] += -0.004458; scores[1] += 0.042238; scores[2] += -0.037780; break;
      case 8: scores[0] += -0.035317; scores[1] += 0.039134; scores[2] += -0.003817; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.014684; scores[1] += 0.013296; scores[2] += -0.027980; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.015091; scores[1] += -0.000902; scores[2] += -0.014190; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.004143; scores[1] += 0.007722; scores[2] += -0.011864; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 122 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[25] > 0.5) << 1) | ((features[14] > 0.5) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009492; scores[1] += -0.000255; scores[2] += -0.009237; break;
      case 1: scores[0] += -0.003077; scores[1] += -0.023397; scores[2] += 0.026475; break;
      case 2: scores[0] += -0.012885; scores[1] += 0.002664; scores[2] += 0.010221; break;
      case 3: scores[0] += -0.006057; scores[1] += 0.049240; scores[2] += -0.043183; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.009805; scores[1] += -0.006260; scores[2] += -0.003545; break;
      case 7: scores[0] += -0.000516; scores[1] += 0.004753; scores[2] += -0.004237; break;
      case 8: scores[0] += 0.003233; scores[1] += -0.037797; scores[2] += 0.034565; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.002914; scores[1] += -0.060853; scores[2] += 0.057940; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.001089; scores[1] += 0.006105; scores[2] += -0.005016; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 123 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1558704376220703) << 0) | ((features[13] > 0.42206478118896484) << 1) | ((features[10] > 8.100000381469727) << 2) | ((features[44] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009231; scores[1] += -0.051654; scores[2] += 0.042424; break;
      case 1: scores[0] += 0.003351; scores[1] += -0.002282; scores[2] += -0.001069; break;
      case 2: scores[0] += -0.029512; scores[1] += 0.035326; scores[2] += -0.005813; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.029437; scores[1] += -0.006025; scores[2] += -0.023413; break;
      case 5: scores[0] += 0.023850; scores[1] += -0.009577; scores[2] += -0.014273; break;
      case 6: scores[0] += 0.014696; scores[1] += 0.014297; scores[2] += -0.028994; break;
      case 7: scores[0] += 0.002284; scores[1] += -0.001623; scores[2] += -0.000660; break;
      case 8: scores[0] += -0.042743; scores[1] += 0.026849; scores[2] += 0.015895; break;
      case 9: scores[0] += -0.001188; scores[1] += 0.023721; scores[2] += -0.022533; break;
      case 10: scores[0] += 0.007795; scores[1] += -0.009208; scores[2] += 0.001413; break;
      case 11: scores[0] += -0.010063; scores[1] += -0.015562; scores[2] += 0.025625; break;
      case 12: scores[0] += -0.023188; scores[1] += 0.012995; scores[2] += 0.010193; break;
      case 13: scores[0] += 0.009297; scores[1] += 0.000461; scores[2] += -0.009758; break;
      case 14: scores[0] += -0.006119; scores[1] += -0.004552; scores[2] += 0.010671; break;
      case 15: scores[0] += 0.047480; scores[1] += -0.015098; scores[2] += -0.032382; break;
    }
  }

  // Tree 124 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[35] > 0.5) << 2) | ((features[10] > 7.900000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003286; scores[1] += 0.001548; scores[2] += 0.001738; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.029928; scores[1] += -0.050993; scores[2] += 0.021066; break;
      case 3: scores[0] += -0.008801; scores[1] += 0.025988; scores[2] += -0.017188; break;
      case 4: scores[0] += -0.025973; scores[1] += 0.018158; scores[2] += 0.007815; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.006086; scores[1] += 0.042494; scores[2] += -0.036408; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.005065; scores[1] += 0.002316; scores[2] += -0.007381; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.013028; scores[1] += -0.038171; scores[2] += 0.051198; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.023165; scores[1] += -0.000595; scores[2] += 0.023760; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003530; scores[1] += 0.001398; scores[2] += 0.002132; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 125 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 5.775000095367432) << 1) | ((features[13] > 0.8164982795715332) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.012431; scores[1] += -0.003450; scores[2] += -0.008981; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000208; scores[1] += -0.002342; scores[2] += 0.002550; break;
      case 3: scores[0] += -0.000246; scores[1] += -0.010704; scores[2] += 0.010949; break;
      case 4: scores[0] += 0.006245; scores[1] += 0.005810; scores[2] += -0.012055; break;
      case 5: scores[0] += 0.004372; scores[1] += 0.015108; scores[2] += -0.019480; break;
      case 6: scores[0] += 0.002831; scores[1] += 0.006732; scores[2] += -0.009563; break;
      case 7: scores[0] += -0.000340; scores[1] += -0.039591; scores[2] += 0.039932; break;
      case 8: scores[0] += -0.007275; scores[1] += 0.007321; scores[2] += -0.000046; break;
      case 9: scores[0] += -0.000118; scores[1] += -0.004040; scores[2] += 0.004158; break;
      case 10: scores[0] += -0.026728; scores[1] += 0.012685; scores[2] += 0.014043; break;
      case 11: scores[0] += -0.000652; scores[1] += -0.005105; scores[2] += 0.005756; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.038032; scores[1] += 0.012267; scores[2] += -0.050299; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 126 (depth=4)
  {
    const leafIdx = ((features[10] > 10.833333969116211) << 0) | ((features[34] > 0.25) << 1) | ((features[9] > 3.5) << 2) | ((features[13] > 0.025978408753871918) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.017553; scores[1] += 0.007342; scores[2] += 0.010211; break;
      case 1: scores[0] += 0.022449; scores[1] += -0.007592; scores[2] += -0.014857; break;
      case 2: scores[0] += 0.054459; scores[1] += -0.013034; scores[2] += -0.041425; break;
      case 3: scores[0] += -0.021763; scores[1] += 0.029747; scores[2] += -0.007984; break;
      case 4: scores[0] += -0.015218; scores[1] += 0.033463; scores[2] += -0.018245; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.015095; scores[1] += -0.031219; scores[2] += 0.046314; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.003141; scores[1] += -0.008321; scores[2] += 0.005180; break;
      case 9: scores[0] += -0.015599; scores[1] += 0.013058; scores[2] += 0.002541; break;
      case 10: scores[0] += 0.006462; scores[1] += 0.024023; scores[2] += -0.030486; break;
      case 11: scores[0] += -0.012836; scores[1] += 0.036500; scores[2] += -0.023663; break;
      case 12: scores[0] += 0.015406; scores[1] += 0.000245; scores[2] += -0.015651; break;
      case 13: scores[0] += -0.000833; scores[1] += 0.005359; scores[2] += -0.004526; break;
      case 14: scores[0] += 0.013873; scores[1] += 0.006058; scores[2] += -0.019931; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 127 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 5.449999809265137) << 1) | ((features[43] > 0.31909090280532837) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.026735; scores[1] += 0.012017; scores[2] += -0.038752; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.001525; scores[1] += -0.004051; scores[2] += 0.002526; break;
      case 3: scores[0] += -0.000848; scores[1] += -0.013403; scores[2] += 0.014250; break;
      case 4: scores[0] += 0.009698; scores[1] += 0.002808; scores[2] += -0.012507; break;
      case 5: scores[0] += 0.007199; scores[1] += -0.003666; scores[2] += -0.003532; break;
      case 6: scores[0] += -0.006527; scores[1] += 0.017597; scores[2] += -0.011070; break;
      case 7: scores[0] += -0.004839; scores[1] += -0.025562; scores[2] += 0.030400; break;
      case 8: scores[0] += -0.010027; scores[1] += -0.031174; scores[2] += 0.041201; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002901; scores[1] += 0.014961; scores[2] += -0.012061; break;
      case 11: scores[0] += 0.008613; scores[1] += -0.004880; scores[2] += -0.003733; break;
      case 12: scores[0] += -0.015458; scores[1] += 0.029198; scores[2] += -0.013741; break;
      case 13: scores[0] += -0.005428; scores[1] += 0.018731; scores[2] += -0.013302; break;
      case 14: scores[0] += -0.019305; scores[1] += -0.033700; scores[2] += 0.053004; break;
      case 15: scores[0] += -0.002466; scores[1] += -0.016801; scores[2] += 0.019268; break;
    }
  }

  // Tree 128 (depth=4)
  {
    const leafIdx = ((features[11] > 0.06155303120613098) << 0) | ((features[10] > 12.833333969116211) << 1) | ((features[13] > 0.7871376872062683) << 2) | ((features[13] > 0.8495475053787231) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.018479; scores[1] += 0.008498; scores[2] += 0.009982; break;
      case 1: scores[0] += 0.008186; scores[1] += -0.007786; scores[2] += -0.000400; break;
      case 2: scores[0] += 0.011278; scores[1] += 0.004654; scores[2] += -0.015931; break;
      case 3: scores[0] += 0.003057; scores[1] += -0.005354; scores[2] += 0.002297; break;
      case 4: scores[0] += -0.015984; scores[1] += -0.019768; scores[2] += 0.035752; break;
      case 5: scores[0] += 0.030526; scores[1] += -0.012460; scores[2] += -0.018066; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.010644; scores[1] += 0.000851; scores[2] += -0.011495; break;
      case 13: scores[0] += 0.013959; scores[1] += -0.003781; scores[2] += -0.010177; break;
      case 14: scores[0] += -0.038608; scores[1] += 0.042507; scores[2] += -0.003899; break;
      case 15: scores[0] += 0.031046; scores[1] += -0.030694; scores[2] += -0.000353; break;
    }
  }

  // Tree 129 (depth=4)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[11] > 0.050641026347875595) << 1) | ((features[13] > 0.5156402587890625) << 2) | ((features[19] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.022476; scores[1] += 0.009009; scores[2] += 0.013468; break;
      case 1: scores[0] += -0.007112; scores[1] += 0.026230; scores[2] += -0.019119; break;
      case 2: scores[0] += 0.005376; scores[1] += 0.001326; scores[2] += -0.006702; break;
      case 3: scores[0] += 0.005294; scores[1] += -0.031286; scores[2] += 0.025992; break;
      case 4: scores[0] += -0.001437; scores[1] += 0.001793; scores[2] += -0.000356; break;
      case 5: scores[0] += -0.025104; scores[1] += -0.007388; scores[2] += 0.032492; break;
      case 6: scores[0] += 0.018159; scores[1] += 0.022581; scores[2] += -0.040740; break;
      case 7: scores[0] += 0.013731; scores[1] += -0.027741; scores[2] += 0.014010; break;
      case 8: scores[0] += 0.039138; scores[1] += -0.002348; scores[2] += -0.036790; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.025334; scores[1] += -0.010803; scores[2] += -0.014530; break;
      case 11: scores[0] += -0.011161; scores[1] += 0.006349; scores[2] += 0.004813; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.019334; scores[1] += 0.040067; scores[2] += -0.020733; break;
      case 15: scores[0] += 0.028748; scores[1] += -0.025893; scores[2] += -0.002855; break;
    }
  }

  // Tree 130 (depth=4)
  {
    const leafIdx = ((features[47] > 0.550000011920929) << 0) | ((features[11] > 0.027402402833104134) << 1) | ((features[13] > 0.5741758346557617) << 2) | ((features[43] > 0.22401434183120728) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004415; scores[1] += 0.003908; scores[2] += -0.008323; break;
      case 1: scores[0] += 0.011630; scores[1] += -0.008683; scores[2] += -0.002947; break;
      case 2: scores[0] += 0.003274; scores[1] += -0.009105; scores[2] += 0.005831; break;
      case 3: scores[0] += 0.001836; scores[1] += -0.000843; scores[2] += -0.000993; break;
      case 4: scores[0] += 0.004031; scores[1] += -0.001653; scores[2] += -0.002377; break;
      case 5: scores[0] += -0.039205; scores[1] += 0.040908; scores[2] += -0.001703; break;
      case 6: scores[0] += 0.011274; scores[1] += -0.001357; scores[2] += -0.009917; break;
      case 7: scores[0] += 0.014509; scores[1] += -0.011181; scores[2] += -0.003327; break;
      case 8: scores[0] += -0.027317; scores[1] += -0.000020; scores[2] += 0.027337; break;
      case 9: scores[0] += -0.002131; scores[1] += 0.003892; scores[2] += -0.001761; break;
      case 10: scores[0] += -0.002162; scores[1] += -0.017315; scores[2] += 0.019477; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.005471; scores[1] += -0.003139; scores[2] += 0.008610; break;
      case 13: scores[0] += -0.002429; scores[1] += 0.004130; scores[2] += -0.001700; break;
      case 14: scores[0] += -0.033442; scores[1] += 0.051884; scores[2] += -0.018443; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 131 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[35] > 0.5) << 1) | ((features[9] > 2.5) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009328; scores[1] += 0.005330; scores[2] += -0.014658; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.036525; scores[1] += -0.017154; scores[2] += 0.053679; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.009318; scores[1] += 0.000071; scores[2] += -0.009389; break;
      case 5: scores[0] += 0.041135; scores[1] += -0.023271; scores[2] += -0.017865; break;
      case 6: scores[0] += -0.022089; scores[1] += 0.007607; scores[2] += 0.014482; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.004110; scores[1] += -0.008762; scores[2] += 0.012872; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.011682; scores[1] += -0.003377; scores[2] += -0.008306; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.016563; scores[1] += 0.000242; scores[2] += 0.016321; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.016897; scores[1] += 0.028982; scores[2] += -0.012084; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 132 (depth=4)
  {
    const leafIdx = ((features[10] > 6.633333206176758) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[13] > 0.4082491397857666) << 2) | ((features[11] > 0.03077651560306549) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.012652; scores[1] += -0.006754; scores[2] += -0.005898; break;
      case 1: scores[0] += -0.007840; scores[1] += 0.013876; scores[2] += -0.006035; break;
      case 2: scores[0] += -0.002578; scores[1] += -0.007266; scores[2] += 0.009844; break;
      case 3: scores[0] += -0.000251; scores[1] += 0.010493; scores[2] += -0.010242; break;
      case 4: scores[0] += 0.001201; scores[1] += 0.006133; scores[2] += -0.007334; break;
      case 5: scores[0] += -0.012467; scores[1] += -0.010257; scores[2] += 0.022724; break;
      case 6: scores[0] += 0.051402; scores[1] += -0.031596; scores[2] += -0.019806; break;
      case 7: scores[0] += -0.005138; scores[1] += -0.003753; scores[2] += 0.008890; break;
      case 8: scores[0] += -0.001976; scores[1] += 0.013209; scores[2] += -0.011233; break;
      case 9: scores[0] += 0.010394; scores[1] += -0.017956; scores[2] += 0.007562; break;
      case 10: scores[0] += -0.009971; scores[1] += 0.014045; scores[2] += -0.004074; break;
      case 11: scores[0] += -0.015197; scores[1] += -0.014568; scores[2] += 0.029765; break;
      case 12: scores[0] += -0.009756; scores[1] += 0.030484; scores[2] += -0.020728; break;
      case 13: scores[0] += 0.008058; scores[1] += -0.004745; scores[2] += -0.003312; break;
      case 14: scores[0] += -0.001741; scores[1] += 0.023509; scores[2] += -0.021767; break;
      case 15: scores[0] += -0.012514; scores[1] += -0.008701; scores[2] += 0.021216; break;
    }
  }

  // Tree 133 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[34] > 0.15000000596046448) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000557; scores[1] += -0.014809; scores[2] += 0.014252; break;
      case 1: scores[0] += 0.006189; scores[1] += -0.012679; scores[2] += 0.006489; break;
      case 2: scores[0] += 0.012305; scores[1] += 0.001045; scores[2] += -0.013350; break;
      case 3: scores[0] += -0.007575; scores[1] += 0.007193; scores[2] += 0.000382; break;
      case 4: scores[0] += -0.001820; scores[1] += 0.025833; scores[2] += -0.024013; break;
      case 5: scores[0] += 0.023391; scores[1] += -0.020357; scores[2] += -0.003034; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.006334; scores[1] += -0.022291; scores[2] += 0.015956; break;
      case 8: scores[0] += -0.034341; scores[1] += 0.026309; scores[2] += 0.008032; break;
      case 9: scores[0] += 0.000417; scores[1] += -0.008808; scores[2] += 0.008391; break;
      case 10: scores[0] += 0.004198; scores[1] += -0.032951; scores[2] += 0.028753; break;
      case 11: scores[0] += -0.027872; scores[1] += 0.036289; scores[2] += -0.008417; break;
      case 12: scores[0] += 0.015201; scores[1] += 0.004809; scores[2] += -0.020009; break;
      case 13: scores[0] += 0.019387; scores[1] += -0.019192; scores[2] += -0.000195; break;
      case 14: scores[0] += -0.026771; scores[1] += 0.049170; scores[2] += -0.022399; break;
      case 15: scores[0] += 0.002271; scores[1] += 0.039726; scores[2] += -0.041997; break;
    }
  }

  // Tree 134 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[10] > 4.099999904632568) << 1) | ((features[44] > 0.25) << 2) | ((features[43] > 0.8516483306884766) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.011843; scores[1] += -0.010427; scores[2] += -0.001416; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.001898; scores[1] += -0.006147; scores[2] += 0.004250; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.002812; scores[1] += 0.016301; scores[2] += -0.013489; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.006763; scores[1] += 0.004803; scores[2] += 0.001960; break;
      case 7: scores[0] += 0.040072; scores[1] += -0.022477; scores[2] += -0.017595; break;
      case 8: scores[0] += -0.037047; scores[1] += 0.018991; scores[2] += 0.018057; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.039340; scores[1] += -0.026749; scores[2] += -0.012591; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.009466; scores[1] += 0.031368; scores[2] += -0.021902; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.014786; scores[1] += 0.013416; scores[2] += 0.001369; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 135 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.633333206176758) << 1) | ((features[13] > 0.5285947918891907) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.021936; scores[1] += 0.001217; scores[2] += -0.023153; break;
      case 1: scores[0] += -0.000435; scores[1] += 0.004327; scores[2] += -0.003891; break;
      case 2: scores[0] += -0.019779; scores[1] += 0.007270; scores[2] += 0.012508; break;
      case 3: scores[0] += -0.001080; scores[1] += 0.005073; scores[2] += -0.003993; break;
      case 4: scores[0] += 0.003590; scores[1] += 0.009974; scores[2] += -0.013564; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000838; scores[1] += 0.001915; scores[2] += -0.002753; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.001535; scores[1] += -0.013307; scores[2] += 0.014842; break;
      case 9: scores[0] += -0.001548; scores[1] += -0.013339; scores[2] += 0.014887; break;
      case 10: scores[0] += 0.016923; scores[1] += -0.023391; scores[2] += 0.006468; break;
      case 11: scores[0] += -0.006465; scores[1] += 0.032018; scores[2] += -0.025553; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.044071; scores[1] += 0.008001; scores[2] += -0.052072; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 136 (depth=4)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[9] > 2.5) << 1) | ((features[10] > 10.291666030883789) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009316; scores[1] += 0.000883; scores[2] += -0.010198; break;
      case 1: scores[0] += -0.015543; scores[1] += -0.025600; scores[2] += 0.041143; break;
      case 2: scores[0] += -0.004011; scores[1] += 0.002793; scores[2] += 0.001218; break;
      case 3: scores[0] += -0.013985; scores[1] += 0.008973; scores[2] += 0.005012; break;
      case 4: scores[0] += -0.002435; scores[1] += 0.005622; scores[2] += -0.003188; break;
      case 5: scores[0] += -0.007359; scores[1] += 0.021931; scores[2] += -0.014572; break;
      case 6: scores[0] += -0.012176; scores[1] += -0.004142; scores[2] += 0.016318; break;
      case 7: scores[0] += -0.007087; scores[1] += -0.011051; scores[2] += 0.018137; break;
      case 8: scores[0] += 0.020603; scores[1] += -0.006038; scores[2] += -0.014565; break;
      case 9: scores[0] += -0.000730; scores[1] += 0.012998; scores[2] += -0.012268; break;
      case 10: scores[0] += 0.029921; scores[1] += -0.030032; scores[2] += 0.000111; break;
      case 11: scores[0] += -0.013599; scores[1] += 0.050631; scores[2] += -0.037033; break;
      case 12: scores[0] += 0.006194; scores[1] += -0.021872; scores[2] += 0.015678; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.014858; scores[1] += 0.056915; scores[2] += -0.042057; break;
      case 15: scores[0] += -0.000924; scores[1] += 0.005387; scores[2] += -0.004463; break;
    }
  }

  // Tree 137 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.633333206176758) << 1) | ((features[27] > 0.5) << 2) | ((features[34] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002687; scores[1] += 0.007604; scores[2] += -0.010291; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000372; scores[1] += 0.000366; scores[2] += -0.000738; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.002154; scores[1] += 0.011725; scores[2] += -0.013879; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001761; scores[1] += -0.039746; scores[2] += 0.041507; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.024995; scores[1] += -0.008793; scores[2] += -0.016202; break;
      case 9: scores[0] += -0.002111; scores[1] += -0.008176; scores[2] += 0.010287; break;
      case 10: scores[0] += -0.010153; scores[1] += -0.020602; scores[2] += 0.030755; break;
      case 11: scores[0] += -0.007391; scores[1] += 0.033188; scores[2] += -0.025797; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 138 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[43] > 0.22653958201408386) << 1) | ((features[43] > 0.2158385068178177) << 2) | ((features[11] > 0.057983193546533585) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003208; scores[1] += 0.004231; scores[2] += -0.001023; break;
      case 1: scores[0] += 0.032429; scores[1] += -0.020447; scores[2] += -0.011981; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.008928; scores[1] += 0.045488; scores[2] += -0.036560; break;
      case 5: scores[0] += -0.000422; scores[1] += -0.037017; scores[2] += 0.037439; break;
      case 6: scores[0] += -0.012759; scores[1] += -0.007156; scores[2] += 0.019915; break;
      case 7: scores[0] += -0.001363; scores[1] += 0.026171; scores[2] += -0.024808; break;
      case 8: scores[0] += 0.017013; scores[1] += -0.009088; scores[2] += -0.007925; break;
      case 9: scores[0] += -0.025416; scores[1] += -0.000501; scores[2] += 0.025916; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.009282; scores[1] += -0.005584; scores[2] += 0.014866; break;
      case 13: scores[0] += -0.000413; scores[1] += 0.002041; scores[2] += -0.001628; break;
      case 14: scores[0] += -0.025929; scores[1] += 0.024117; scores[2] += 0.001812; break;
      case 15: scores[0] += -0.000488; scores[1] += 0.005541; scores[2] += -0.005053; break;
    }
  }

  // Tree 139 (depth=4)
  {
    const leafIdx = ((features[10] > 7.224999904632568) << 0) | ((features[11] > 0.1889880895614624) << 1) | ((features[3] > 0.5) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004319; scores[1] += -0.000925; scores[2] += -0.003394; break;
      case 1: scores[0] += -0.003061; scores[1] += -0.004516; scores[2] += 0.007577; break;
      case 2: scores[0] += -0.006869; scores[1] += -0.009605; scores[2] += 0.016474; break;
      case 3: scores[0] += 0.038471; scores[1] += -0.007377; scores[2] += -0.031094; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.000744; scores[1] += 0.005041; scores[2] += -0.004298; break;
      case 6: scores[0] += 0.001311; scores[1] += 0.012341; scores[2] += -0.013652; break;
      case 7: scores[0] += 0.010763; scores[1] += -0.005761; scores[2] += -0.005002; break;
      case 8: scores[0] += 0.001716; scores[1] += 0.001965; scores[2] += -0.003681; break;
      case 9: scores[0] += -0.001451; scores[1] += -0.000950; scores[2] += 0.002401; break;
      case 10: scores[0] += -0.005119; scores[1] += 0.041902; scores[2] += -0.036783; break;
      case 11: scores[0] += -0.003946; scores[1] += 0.025507; scores[2] += -0.021561; break;
      case 12: scores[0] += -0.019782; scores[1] += 0.017352; scores[2] += 0.002430; break;
      case 13: scores[0] += -0.000283; scores[1] += 0.030316; scores[2] += -0.030033; break;
      case 14: scores[0] += -0.008619; scores[1] += 0.001913; scores[2] += 0.006706; break;
      case 15: scores[0] += -0.007467; scores[1] += -0.011191; scores[2] += 0.018657; break;
    }
  }

  // Tree 140 (depth=4)
  {
    const leafIdx = ((features[10] > 13.25) << 0) | ((features[4] > 0.5) << 1) | ((features[11] > 0.037749290466308594) << 2) | ((features[13] > 0.8164982795715332) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.026926; scores[1] += 0.012903; scores[2] += 0.014023; break;
      case 1: scores[0] += -0.006646; scores[1] += 0.015614; scores[2] += -0.008969; break;
      case 2: scores[0] += 0.006363; scores[1] += -0.031794; scores[2] += 0.025431; break;
      case 3: scores[0] += 0.017068; scores[1] += -0.000333; scores[2] += -0.016736; break;
      case 4: scores[0] += -0.006074; scores[1] += 0.001655; scores[2] += 0.004420; break;
      case 5: scores[0] += -0.019433; scores[1] += -0.001616; scores[2] += 0.021049; break;
      case 6: scores[0] += 0.028535; scores[1] += -0.010219; scores[2] += -0.018317; break;
      case 7: scores[0] += 0.029850; scores[1] += -0.009349; scores[2] += -0.020502; break;
      case 8: scores[0] += 0.005809; scores[1] += -0.003779; scores[2] += -0.002030; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.011363; scores[1] += 0.000176; scores[2] += -0.011539; break;
      case 11: scores[0] += -0.036574; scores[1] += 0.048958; scores[2] += -0.012385; break;
      case 12: scores[0] += 0.007450; scores[1] += 0.025994; scores[2] += -0.033443; break;
      case 13: scores[0] += -0.004609; scores[1] += -0.023690; scores[2] += 0.028299; break;
      case 14: scores[0] += 0.008683; scores[1] += -0.006804; scores[2] += -0.001879; break;
      case 15: scores[0] += 0.024603; scores[1] += -0.018730; scores[2] += -0.005873; break;
    }
  }

  // Tree 141 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1889880895614624) << 0) | ((features[11] > 0.20416666567325592) << 1) | ((features[13] > 0.13714733719825745) << 2) | ((features[3] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000505; scores[1] += 0.003009; scores[2] += -0.002504; break;
      case 1: scores[0] += 0.000964; scores[1] += -0.000189; scores[2] += -0.000774; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000890; scores[1] += -0.000171; scores[2] += -0.000719; break;
      case 4: scores[0] += -0.000909; scores[1] += -0.003338; scores[2] += 0.004247; break;
      case 5: scores[0] += -0.006744; scores[1] += 0.044226; scores[2] += -0.037482; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.026147; scores[1] += 0.002148; scores[2] += -0.028295; break;
      case 8: scores[0] += -0.007716; scores[1] += 0.041755; scores[2] += -0.034040; break;
      case 9: scores[0] += -0.003510; scores[1] += 0.012583; scores[2] += -0.009074; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.008206; scores[1] += -0.018972; scores[2] += 0.010766; break;
      case 12: scores[0] += -0.008915; scores[1] += 0.003512; scores[2] += 0.005403; break;
      case 13: scores[0] += -0.001024; scores[1] += 0.007537; scores[2] += -0.006513; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.009979; scores[1] += 0.001880; scores[2] += 0.008099; break;
    }
  }

  // Tree 142 (depth=4)
  {
    const leafIdx = ((features[13] > 0.134848490357399) << 0) | ((features[13] > 0.521164059638977) << 1) | ((features[14] > 0.5) << 2) | ((features[13] > 0.5779352188110352) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000769; scores[1] += 0.003464; scores[2] += -0.004232; break;
      case 1: scores[0] += 0.019013; scores[1] += -0.048597; scores[2] += 0.029584; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.043290; scores[1] += -0.008136; scores[2] += -0.035155; break;
      case 4: scores[0] += -0.009471; scores[1] += 0.020077; scores[2] += -0.010606; break;
      case 5: scores[0] += -0.020574; scores[1] += 0.014357; scores[2] += 0.006218; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.005190; scores[1] += 0.020591; scores[2] += -0.015401; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.013913; scores[1] += 0.015149; scores[2] += -0.001237; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.005522; scores[1] += -0.003119; scores[2] += -0.002403; break;
    }
  }

  // Tree 143 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 6.550000190734863) << 1) | ((features[13] > 0.3623737394809723) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.016561; scores[1] += 0.007071; scores[2] += 0.009490; break;
      case 1: scores[0] += -0.005237; scores[1] += 0.000948; scores[2] += 0.004289; break;
      case 2: scores[0] += -0.023395; scores[1] += 0.016837; scores[2] += 0.006558; break;
      case 3: scores[0] += -0.003005; scores[1] += 0.029717; scores[2] += -0.026713; break;
      case 4: scores[0] += 0.008183; scores[1] += 0.011846; scores[2] += -0.020029; break;
      case 5: scores[0] += -0.001395; scores[1] += 0.007641; scores[2] += -0.006247; break;
      case 6: scores[0] += -0.000279; scores[1] += -0.011922; scores[2] += 0.012201; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.026891; scores[1] += -0.021383; scores[2] += -0.005508; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.025784; scores[1] += -0.027347; scores[2] += 0.001564; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.001300; scores[1] += -0.000040; scores[2] += -0.001261; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.010989; scores[1] += 0.015084; scores[2] += -0.026073; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 144 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 6.224999904632568) << 1) | ((features[13] > 0.22474747896194458) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.029164; scores[1] += -0.004158; scores[2] += -0.025006; break;
      case 1: scores[0] += -0.004865; scores[1] += -0.012647; scores[2] += 0.017512; break;
      case 2: scores[0] += 0.001343; scores[1] += 0.000541; scores[2] += -0.001883; break;
      case 3: scores[0] += -0.018133; scores[1] += 0.002046; scores[2] += 0.016087; break;
      case 4: scores[0] += 0.012554; scores[1] += 0.007885; scores[2] += -0.020439; break;
      case 5: scores[0] += 0.025683; scores[1] += -0.013458; scores[2] += -0.012226; break;
      case 6: scores[0] += -0.015532; scores[1] += -0.009019; scores[2] += 0.024550; break;
      case 7: scores[0] += 0.022214; scores[1] += -0.023366; scores[2] += 0.001152; break;
      case 8: scores[0] += -0.001844; scores[1] += 0.016941; scores[2] += -0.015097; break;
      case 9: scores[0] += -0.001132; scores[1] += -0.042913; scores[2] += 0.044045; break;
      case 10: scores[0] += -0.016293; scores[1] += 0.019160; scores[2] += -0.002867; break;
      case 11: scores[0] += -0.000220; scores[1] += 0.009863; scores[2] += -0.009643; break;
      case 12: scores[0] += -0.010961; scores[1] += 0.007398; scores[2] += 0.003563; break;
      case 13: scores[0] += -0.001566; scores[1] += 0.027388; scores[2] += -0.025822; break;
      case 14: scores[0] += 0.007596; scores[1] += -0.002549; scores[2] += -0.005046; break;
      case 15: scores[0] += -0.015679; scores[1] += 0.013739; scores[2] += 0.001940; break;
    }
  }

  // Tree 145 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[10] > 10.583333969116211) << 1) | ((features[11] > 0.07549858093261719) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000865; scores[1] += -0.005566; scores[2] += 0.004702; break;
      case 1: scores[0] += 0.003117; scores[1] += 0.001735; scores[2] += -0.004852; break;
      case 2: scores[0] += -0.009791; scores[1] += 0.006077; scores[2] += 0.003713; break;
      case 3: scores[0] += 0.010753; scores[1] += -0.009747; scores[2] += -0.001006; break;
      case 4: scores[0] += -0.013224; scores[1] += 0.012896; scores[2] += 0.000328; break;
      case 5: scores[0] += 0.038087; scores[1] += -0.008883; scores[2] += -0.029205; break;
      case 6: scores[0] += 0.033662; scores[1] += -0.029024; scores[2] += -0.004638; break;
      case 7: scores[0] += -0.030592; scores[1] += 0.072208; scores[2] += -0.041616; break;
      case 8: scores[0] += -0.001686; scores[1] += 0.005823; scores[2] += -0.004137; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.012024; scores[1] += 0.035045; scores[2] += -0.023021; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.006767; scores[1] += 0.003359; scores[2] += 0.003408; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002058; scores[1] += -0.031752; scores[2] += 0.033810; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 146 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1558704376220703) << 0) | ((features[33] > 0.5) << 1) | ((features[3] > 0.5) << 2) | ((features[10] > 8.583333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003495; scores[1] += 0.001022; scores[2] += 0.002474; break;
      case 1: scores[0] += 0.037249; scores[1] += -0.004009; scores[2] += -0.033239; break;
      case 2: scores[0] += -0.005363; scores[1] += -0.001094; scores[2] += 0.006457; break;
      case 3: scores[0] += -0.004996; scores[1] += 0.039930; scores[2] += -0.034935; break;
      case 4: scores[0] += -0.013169; scores[1] += 0.024850; scores[2] += -0.011681; break;
      case 5: scores[0] += -0.018892; scores[1] += 0.021663; scores[2] += -0.002772; break;
      case 6: scores[0] += -0.002942; scores[1] += 0.010533; scores[2] += -0.007592; break;
      case 7: scores[0] += -0.001099; scores[1] += -0.021293; scores[2] += 0.022392; break;
      case 8: scores[0] += 0.003137; scores[1] += -0.005604; scores[2] += 0.002468; break;
      case 9: scores[0] += 0.028692; scores[1] += -0.015115; scores[2] += -0.013577; break;
      case 10: scores[0] += -0.010997; scores[1] += 0.021432; scores[2] += -0.010435; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.003467; scores[1] += 0.020325; scores[2] += -0.016857; break;
      case 13: scores[0] += 0.006940; scores[1] += -0.008395; scores[2] += 0.001455; break;
      case 14: scores[0] += -0.006225; scores[1] += -0.007825; scores[2] += 0.014050; break;
      case 15: scores[0] += 0.019717; scores[1] += -0.008186; scores[2] += -0.011531; break;
    }
  }

  // Tree 147 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[43] > 0.6651785373687744) << 1) | ((features[44] > 0.550000011920929) << 2) | ((features[43] > 0.24500000476837158) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002299; scores[1] += 0.001206; scores[2] += -0.003506; break;
      case 1: scores[0] += 0.039627; scores[1] += -0.021504; scores[2] += -0.018124; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000397; scores[1] += 0.002428; scores[2] += -0.002031; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.028075; scores[1] += -0.003374; scores[2] += 0.031449; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002497; scores[1] += 0.003100; scores[2] += -0.000603; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003768; scores[1] += 0.025267; scores[2] += -0.021499; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 148 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[43] > 0.13563218712806702) << 1) | ((features[9] > 3.5) << 2) | ((features[11] > 0.05480480566620827) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006330; scores[1] += 0.002984; scores[2] += 0.003346; break;
      case 1: scores[0] += 0.005619; scores[1] += -0.025142; scores[2] += 0.019523; break;
      case 2: scores[0] += -0.015182; scores[1] += -0.005206; scores[2] += 0.020388; break;
      case 3: scores[0] += -0.001305; scores[1] += 0.030297; scores[2] += -0.028992; break;
      case 4: scores[0] += 0.031697; scores[1] += 0.015866; scores[2] += -0.047563; break;
      case 5: scores[0] += 0.032231; scores[1] += -0.018945; scores[2] += -0.013286; break;
      case 6: scores[0] += 0.031388; scores[1] += -0.050773; scores[2] += 0.019385; break;
      case 7: scores[0] += -0.004877; scores[1] += 0.007430; scores[2] += -0.002553; break;
      case 8: scores[0] += 0.019475; scores[1] += -0.014311; scores[2] += -0.005165; break;
      case 9: scores[0] += 0.026638; scores[1] += 0.012296; scores[2] += -0.038934; break;
      case 10: scores[0] += -0.046605; scores[1] += 0.035572; scores[2] += 0.011033; break;
      case 11: scores[0] += -0.000156; scores[1] += -0.012083; scores[2] += 0.012238; break;
      case 12: scores[0] += -0.019433; scores[1] += -0.011677; scores[2] += 0.031111; break;
      case 13: scores[0] += -0.030219; scores[1] += 0.018980; scores[2] += 0.011239; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.002542; scores[1] += 0.014902; scores[2] += -0.012359; break;
    }
  }

  // Tree 149 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[34] > 0.15000000596046448) << 1) | ((features[13] > 0.8360214829444885) << 2) | ((features[10] > 8.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.027930; scores[1] += 0.012184; scores[2] += 0.015746; break;
      case 1: scores[0] += 0.032993; scores[1] += -0.017907; scores[2] += -0.015086; break;
      case 2: scores[0] += 0.007074; scores[1] += 0.003192; scores[2] += -0.010266; break;
      case 3: scores[0] += 0.008144; scores[1] += -0.004426; scores[2] += -0.003718; break;
      case 4: scores[0] += 0.005687; scores[1] += 0.002622; scores[2] += -0.008309; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.022275; scores[1] += 0.016442; scores[2] += 0.005833; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000730; scores[1] += -0.004582; scores[2] += 0.005313; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.005541; scores[1] += 0.013901; scores[2] += -0.019442; break;
      case 11: scores[0] += 0.006214; scores[1] += -0.003509; scores[2] += -0.002705; break;
      case 12: scores[0] += 0.004976; scores[1] += 0.008595; scores[2] += -0.013571; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.026944; scores[1] += -0.019092; scores[2] += -0.007852; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 150 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[43] > 0.19615384936332703) << 1) | ((features[30] > 0.5) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010085; scores[1] += -0.002514; scores[2] += -0.007571; break;
      case 1: scores[0] += -0.001088; scores[1] += 0.003671; scores[2] += -0.002583; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.008760; scores[1] += -0.057989; scores[2] += 0.049229; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.014240; scores[1] += -0.021879; scores[2] += 0.007639; break;
      case 10: scores[0] += -0.000792; scores[1] += 0.004541; scores[2] += -0.003749; break;
      case 11: scores[0] += -0.013289; scores[1] += 0.025754; scores[2] += -0.012465; break;
      case 12: scores[0] += -0.000247; scores[1] += 0.002250; scores[2] += -0.002003; break;
      case 13: scores[0] += 0.002458; scores[1] += 0.025233; scores[2] += -0.027691; break;
      case 14: scores[0] += -0.031836; scores[1] += 0.029422; scores[2] += 0.002414; break;
      case 15: scores[0] += 0.000072; scores[1] += -0.022404; scores[2] += 0.022332; break;
    }
  }

  // Tree 151 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[13] > 0.024725275114178658) << 1) | ((features[43] > 0.15894736349582672) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007788; scores[1] += -0.002050; scores[2] += -0.005738; break;
      case 1: scores[0] += -0.002698; scores[1] += -0.022635; scores[2] += 0.025333; break;
      case 2: scores[0] += 0.003751; scores[1] += -0.004502; scores[2] += 0.000750; break;
      case 3: scores[0] += -0.005501; scores[1] += 0.043038; scores[2] += -0.037537; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.005416; scores[1] += -0.000953; scores[2] += 0.006369; break;
      case 7: scores[0] += -0.000402; scores[1] += 0.004080; scores[2] += -0.003678; break;
      case 8: scores[0] += -0.017084; scores[1] += -0.015050; scores[2] += 0.032134; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.011233; scores[1] += 0.010413; scores[2] += -0.021646; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.033628; scores[1] += 0.009895; scores[2] += 0.023733; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 152 (depth=4)
  {
    const leafIdx = ((features[31] > 0.5) << 0) | ((features[10] > 10.291666030883789) << 1) | ((features[44] > 0.25) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.017881; scores[1] += 0.000400; scores[2] += -0.018281; break;
      case 1: scores[0] += 0.004606; scores[1] += -0.018548; scores[2] += 0.013942; break;
      case 2: scores[0] += 0.003438; scores[1] += 0.008790; scores[2] += -0.012228; break;
      case 3: scores[0] += 0.005914; scores[1] += -0.040855; scores[2] += 0.034940; break;
      case 4: scores[0] += -0.009108; scores[1] += 0.004521; scores[2] += 0.004588; break;
      case 5: scores[0] += 0.016956; scores[1] += -0.009655; scores[2] += -0.007301; break;
      case 6: scores[0] += -0.011721; scores[1] += -0.005741; scores[2] += 0.017462; break;
      case 7: scores[0] += -0.025274; scores[1] += 0.049983; scores[2] += -0.024709; break;
      case 8: scores[0] += -0.014326; scores[1] += -0.023495; scores[2] += 0.037821; break;
      case 9: scores[0] += -0.000621; scores[1] += 0.012021; scores[2] += -0.011401; break;
      case 10: scores[0] += -0.006807; scores[1] += 0.019949; scores[2] += -0.013143; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.014324; scores[1] += 0.012322; scores[2] += 0.002002; break;
      case 13: scores[0] += -0.011230; scores[1] += 0.044235; scores[2] += -0.033005; break;
      case 14: scores[0] += -0.008076; scores[1] += -0.005205; scores[2] += 0.013280; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 153 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 5.449999809265137) << 1) | ((features[43] > 0.27681994438171387) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.029027; scores[1] += 0.012177; scores[2] += -0.041204; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.001804; scores[1] += -0.003030; scores[2] += 0.001227; break;
      case 3: scores[0] += -0.000423; scores[1] += -0.001068; scores[2] += 0.001491; break;
      case 4: scores[0] += 0.006836; scores[1] += 0.000908; scores[2] += -0.007744; break;
      case 5: scores[0] += 0.005324; scores[1] += -0.001913; scores[2] += -0.003411; break;
      case 6: scores[0] += -0.007746; scores[1] += 0.010036; scores[2] += -0.002290; break;
      case 7: scores[0] += -0.005787; scores[1] += -0.029053; scores[2] += 0.034839; break;
      case 8: scores[0] += -0.008066; scores[1] += -0.028781; scores[2] += 0.036847; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002590; scores[1] += 0.013849; scores[2] += -0.011259; break;
      case 11: scores[0] += 0.007519; scores[1] += -0.004443; scores[2] += -0.003076; break;
      case 12: scores[0] += -0.015322; scores[1] += 0.020506; scores[2] += -0.005184; break;
      case 13: scores[0] += -0.004612; scores[1] += 0.016845; scores[2] += -0.012233; break;
      case 14: scores[0] += -0.009694; scores[1] += -0.021059; scores[2] += 0.030753; break;
      case 15: scores[0] += -0.002118; scores[1] += -0.014969; scores[2] += 0.017087; break;
    }
  }

  // Tree 154 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1558704376220703) << 0) | ((features[31] > 0.5) << 1) | ((features[33] > 0.5) << 2) | ((features[13] > 0.9298029541969299) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006349; scores[1] += -0.001283; scores[2] += 0.007632; break;
      case 1: scores[0] += 0.029071; scores[1] += 0.002775; scores[2] += -0.031845; break;
      case 2: scores[0] += 0.014264; scores[1] += 0.005443; scores[2] += -0.019707; break;
      case 3: scores[0] += 0.003128; scores[1] += -0.007784; scores[2] += 0.004656; break;
      case 4: scores[0] += -0.040613; scores[1] += 0.029748; scores[2] += 0.010865; break;
      case 5: scores[0] += 0.016238; scores[1] += -0.010436; scores[2] += -0.005801; break;
      case 6: scores[0] += 0.000298; scores[1] += 0.000763; scores[2] += -0.001061; break;
      case 7: scores[0] += -0.002094; scores[1] += 0.020397; scores[2] += -0.018303; break;
      case 8: scores[0] += 0.007583; scores[1] += 0.009977; scores[2] += -0.017561; break;
      case 9: scores[0] += 0.000947; scores[1] += -0.000710; scores[2] += -0.000237; break;
      case 10: scores[0] += 0.000776; scores[1] += -0.009979; scores[2] += 0.009202; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.050241; scores[1] += -0.026568; scores[2] += -0.023673; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.007670; scores[1] += -0.003264; scores[2] += 0.010934; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 155 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 5.900000095367432) << 1) | ((features[43] > 0.21807065606117249) << 2) | ((features[10] > 7.550000190734863) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005444; scores[1] += 0.018470; scores[2] += -0.023914; break;
      case 1: scores[0] += 0.022800; scores[1] += -0.060004; scores[2] += 0.037203; break;
      case 2: scores[0] += -0.001470; scores[1] += 0.001006; scores[2] += 0.000465; break;
      case 3: scores[0] += -0.001538; scores[1] += 0.018347; scores[2] += -0.016809; break;
      case 4: scores[0] += -0.001649; scores[1] += -0.002657; scores[2] += 0.004306; break;
      case 5: scores[0] += -0.001399; scores[1] += 0.022920; scores[2] += -0.021522; break;
      case 6: scores[0] += -0.014805; scores[1] += -0.007267; scores[2] += 0.022072; break;
      case 7: scores[0] += -0.000149; scores[1] += 0.005619; scores[2] += -0.005470; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.005221; scores[1] += -0.000813; scores[2] += -0.004408; break;
      case 11: scores[0] += -0.016297; scores[1] += -0.033374; scores[2] += 0.049671; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.017489; scores[1] += 0.013809; scores[2] += 0.003680; break;
      case 15: scores[0] += -0.000363; scores[1] += 0.001728; scores[2] += -0.001365; break;
    }
  }

  // Tree 156 (depth=4)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[11] > 0.1889880895614624) << 1) | ((features[2] > 0.5) << 2) | ((features[11] > 0.051956817507743835) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002848; scores[1] += 0.000513; scores[2] += 0.002335; break;
      case 1: scores[0] += 0.004743; scores[1] += 0.001753; scores[2] += -0.006496; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000076; scores[1] += 0.014886; scores[2] += -0.014962; break;
      case 5: scores[0] += -0.036682; scores[1] += 0.012086; scores[2] += 0.024596; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.035054; scores[1] += -0.012688; scores[2] += -0.022366; break;
      case 9: scores[0] += -0.007384; scores[1] += 0.020067; scores[2] += -0.012683; break;
      case 10: scores[0] += 0.000728; scores[1] += 0.005860; scores[2] += -0.006588; break;
      case 11: scores[0] += -0.004392; scores[1] += 0.038073; scores[2] += -0.033680; break;
      case 12: scores[0] += -0.002401; scores[1] += -0.008769; scores[2] += 0.011170; break;
      case 13: scores[0] += 0.019645; scores[1] += -0.048799; scores[2] += 0.029154; break;
      case 14: scores[0] += 0.015429; scores[1] += -0.005301; scores[2] += -0.010128; break;
      case 15: scores[0] += -0.001829; scores[1] += -0.001764; scores[2] += 0.003593; break;
    }
  }

  // Tree 157 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[10] > 4.7083330154418945) << 1) | ((features[10] > 4.633333206176758) << 2) | ((features[13] > 0.39379698038101196) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008844; scores[1] += 0.000624; scores[2] += -0.009468; break;
      case 1: scores[0] += -0.001812; scores[1] += 0.009211; scores[2] += -0.007398; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001826; scores[1] += 0.007082; scores[2] += -0.005257; break;
      case 5: scores[0] += -0.000087; scores[1] += 0.000594; scores[2] += -0.000507; break;
      case 6: scores[0] += -0.000471; scores[1] += -0.000527; scores[2] += 0.000997; break;
      case 7: scores[0] += -0.012393; scores[1] += 0.043803; scores[2] += -0.031411; break;
      case 8: scores[0] += -0.034295; scores[1] += 0.023658; scores[2] += 0.010637; break;
      case 9: scores[0] += -0.000030; scores[1] += 0.000220; scores[2] += -0.000191; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.003732; scores[1] += -0.019951; scores[2] += 0.023683; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.004201; scores[1] += -0.007996; scores[2] += 0.003795; break;
      case 15: scores[0] += -0.008812; scores[1] += 0.036309; scores[2] += -0.027497; break;
    }
  }

  // Tree 158 (depth=4)
  {
    const leafIdx = ((features[43] > 0.1913919448852539) << 0) | ((features[43] > 0.21807065606117249) << 1) | ((features[34] > 0.3500000238418579) << 2) | ((features[13] > 0.9183333516120911) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001614; scores[1] += 0.001392; scores[2] += -0.003006; break;
      case 1: scores[0] += -0.008699; scores[1] += 0.004031; scores[2] += 0.004668; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.032416; scores[1] += 0.011299; scores[2] += 0.021117; break;
      case 4: scores[0] += -0.001302; scores[1] += -0.012756; scores[2] += 0.014058; break;
      case 5: scores[0] += -0.000425; scores[1] += -0.035765; scores[2] += 0.036189; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.001732; scores[1] += 0.025346; scores[2] += -0.023614; break;
      case 8: scores[0] += 0.011424; scores[1] += 0.013095; scores[2] += -0.024518; break;
      case 9: scores[0] += 0.030974; scores[1] += -0.050235; scores[2] += 0.019261; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.004004; scores[1] += -0.001746; scores[2] += 0.005750; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 159 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 5.775000095367432) << 1) | ((features[43] > 0.2204861044883728) << 2) | ((features[13] > 0.4082491397857666) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010157; scores[1] += 0.011694; scores[2] += -0.021850; break;
      case 1: scores[0] += -0.002632; scores[1] += -0.043596; scores[2] += 0.046228; break;
      case 2: scores[0] += 0.001906; scores[1] += 0.005673; scores[2] += -0.007579; break;
      case 3: scores[0] += -0.021247; scores[1] += 0.004082; scores[2] += 0.017165; break;
      case 4: scores[0] += -0.005311; scores[1] += -0.021752; scores[2] += 0.027063; break;
      case 5: scores[0] += -0.001356; scores[1] += 0.021756; scores[2] += -0.020400; break;
      case 6: scores[0] += -0.019722; scores[1] += -0.008960; scores[2] += 0.028683; break;
      case 7: scores[0] += -0.000145; scores[1] += 0.005372; scores[2] += -0.005227; break;
      case 8: scores[0] += -0.005037; scores[1] += 0.017525; scores[2] += -0.012488; break;
      case 9: scores[0] += 0.026466; scores[1] += -0.018187; scores[2] += -0.008279; break;
      case 10: scores[0] += 0.002091; scores[1] += -0.009016; scores[2] += 0.006925; break;
      case 11: scores[0] += 0.001579; scores[1] += -0.003097; scores[2] += 0.001518; break;
      case 12: scores[0] += 0.005380; scores[1] += 0.004949; scores[2] += -0.010329; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.012445; scores[1] += 0.008649; scores[2] += 0.003796; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 160 (depth=4)
  {
    const leafIdx = ((features[11] > 0.028991596773266792) << 0) | ((features[11] > 0.03637566417455673) << 1) | ((features[40] > 0.5) << 2) | ((features[13] > 0.5285947918891907) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003256; scores[1] += -0.003943; scores[2] += 0.007199; break;
      case 1: scores[0] += -0.003360; scores[1] += 0.017140; scores[2] += -0.013780; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.006888; scores[1] += -0.004936; scores[2] += -0.001952; break;
      case 4: scores[0] += 0.000929; scores[1] += 0.015688; scores[2] += -0.016618; break;
      case 5: scores[0] += -0.014393; scores[1] += -0.032610; scores[2] += 0.047003; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.008816; scores[1] += -0.006657; scores[2] += 0.015473; break;
      case 8: scores[0] += 0.009705; scores[1] += 0.006965; scores[2] += -0.016670; break;
      case 9: scores[0] += -0.002903; scores[1] += 0.016763; scores[2] += -0.013860; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.017846; scores[1] += -0.001228; scores[2] += -0.016618; break;
      case 12: scores[0] += -0.037954; scores[1] += 0.002426; scores[2] += 0.035528; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.006213; scores[1] += 0.022083; scores[2] += -0.015870; break;
    }
  }

  // Tree 161 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1889880895614624) << 0) | ((features[11] > 0.2124060094356537) << 1) | ((features[13] > 0.09545454382896423) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.015839; scores[1] += -0.018665; scores[2] += 0.002826; break;
      case 1: scores[0] += 0.000782; scores[1] += -0.000146; scores[2] += -0.000636; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.011144; scores[1] += -0.006133; scores[2] += -0.005011; break;
      case 4: scores[0] += -0.001573; scores[1] += 0.000149; scores[2] += 0.001424; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.024285; scores[1] += -0.003710; scores[2] += -0.020575; break;
      case 8: scores[0] += -0.022890; scores[1] += 0.024593; scores[2] += -0.001703; break;
      case 9: scores[0] += -0.004520; scores[1] += 0.006152; scores[2] += -0.001632; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.001785; scores[1] += 0.001639; scores[2] += 0.000146; break;
      case 12: scores[0] += -0.000563; scores[1] += -0.003253; scores[2] += 0.003817; break;
      case 13: scores[0] += -0.009729; scores[1] += 0.057619; scores[2] += -0.047890; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.008578; scores[1] += -0.018980; scores[2] += 0.027558; break;
    }
  }

  // Tree 162 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[11] > 0.051956817507743835) << 2) | ((features[13] > 0.4588963985443115) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000175; scores[1] += 0.007383; scores[2] += -0.007208; break;
      case 1: scores[0] += -0.006321; scores[1] += -0.028308; scores[2] += 0.034629; break;
      case 2: scores[0] += -0.023595; scores[1] += 0.004146; scores[2] += 0.019449; break;
      case 3: scores[0] += -0.001145; scores[1] += 0.026595; scores[2] += -0.025450; break;
      case 4: scores[0] += 0.009241; scores[1] += -0.004898; scores[2] += -0.004343; break;
      case 5: scores[0] += -0.018698; scores[1] += -0.005548; scores[2] += 0.024245; break;
      case 6: scores[0] += -0.014330; scores[1] += 0.014660; scores[2] += -0.000329; break;
      case 7: scores[0] += -0.003805; scores[1] += 0.009794; scores[2] += -0.005988; break;
      case 8: scores[0] += -0.004270; scores[1] += -0.001319; scores[2] += 0.005588; break;
      case 9: scores[0] += 0.049654; scores[1] += -0.034232; scores[2] += -0.015421; break;
      case 10: scores[0] += -0.011946; scores[1] += 0.013897; scores[2] += -0.001952; break;
      case 11: scores[0] += -0.003014; scores[1] += 0.007713; scores[2] += -0.004699; break;
      case 12: scores[0] += 0.007541; scores[1] += -0.003556; scores[2] += -0.003985; break;
      case 13: scores[0] += -0.011642; scores[1] += -0.003193; scores[2] += 0.014835; break;
      case 14: scores[0] += 0.008938; scores[1] += -0.006329; scores[2] += -0.002609; break;
      case 15: scores[0] += -0.001295; scores[1] += 0.013190; scores[2] += -0.011896; break;
    }
  }

  // Tree 163 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[43] > 0.22653958201408386) << 2) | ((features[10] > 5.900000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000620; scores[1] += 0.018645; scores[2] += -0.019265; break;
      case 1: scores[0] += 0.007639; scores[1] += -0.004909; scores[2] += -0.002730; break;
      case 2: scores[0] += 0.022293; scores[1] += -0.053399; scores[2] += 0.031107; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000148; scores[1] += -0.003282; scores[2] += 0.003430; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001335; scores[1] += 0.021661; scores[2] += -0.020326; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.001032; scores[1] += 0.000933; scores[2] += -0.001965; break;
      case 9: scores[0] += 0.034518; scores[1] += -0.018224; scores[2] += -0.016294; break;
      case 10: scores[0] += -0.014368; scores[1] += 0.002178; scores[2] += 0.012190; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.015089; scores[1] += 0.000171; scores[2] += 0.014918; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000141; scores[1] += 0.005144; scores[2] += -0.005003; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 164 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[13] > 0.011904762126505375) << 1) | ((features[14] > 0.5) << 2) | ((features[10] > 11.583333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004590; scores[1] += 0.002239; scores[2] += 0.002352; break;
      case 1: scores[0] += -0.002630; scores[1] += -0.020308; scores[2] += 0.022938; break;
      case 2: scores[0] += 0.020842; scores[1] += -0.027136; scores[2] += 0.006294; break;
      case 3: scores[0] += -0.005302; scores[1] += 0.041538; scores[2] += -0.036236; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.001985; scores[1] += 0.003531; scores[2] += -0.005516; break;
      case 7: scores[0] += -0.000419; scores[1] += 0.003885; scores[2] += -0.003465; break;
      case 8: scores[0] += 0.016229; scores[1] += -0.006817; scores[2] += -0.009412; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.039929; scores[1] += 0.034701; scores[2] += 0.005228; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000387; scores[1] += -0.014953; scores[2] += 0.015340; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 165 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1558704376220703) << 0) | ((features[3] > 0.5) << 1) | ((features[10] > 6.099999904632568) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002420; scores[1] += 0.001848; scores[2] += -0.004268; break;
      case 1: scores[0] += 0.027945; scores[1] += -0.012438; scores[2] += -0.015507; break;
      case 2: scores[0] += -0.001722; scores[1] += 0.011431; scores[2] += -0.009709; break;
      case 3: scores[0] += -0.011185; scores[1] += 0.007363; scores[2] += 0.003822; break;
      case 4: scores[0] += -0.001481; scores[1] += -0.002556; scores[2] += 0.004037; break;
      case 5: scores[0] += 0.016189; scores[1] += 0.021106; scores[2] += -0.037296; break;
      case 6: scores[0] += -0.018795; scores[1] += 0.003593; scores[2] += 0.015202; break;
      case 7: scores[0] += 0.013886; scores[1] += 0.002160; scores[2] += -0.016046; break;
      case 8: scores[0] += -0.007891; scores[1] += 0.006606; scores[2] += 0.001285; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000099; scores[1] += 0.000344; scores[2] += -0.000245; break;
      case 11: scores[0] += -0.002565; scores[1] += -0.003249; scores[2] += 0.005814; break;
      case 12: scores[0] += -0.006920; scores[1] += 0.004626; scores[2] += 0.002294; break;
      case 13: scores[0] += 0.016342; scores[1] += -0.001282; scores[2] += -0.015060; break;
      case 14: scores[0] += -0.002568; scores[1] += 0.041952; scores[2] += -0.039384; break;
      case 15: scores[0] += -0.006109; scores[1] += -0.008763; scores[2] += 0.014872; break;
    }
  }

  // Tree 166 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.8495475053787231) << 1) | ((features[13] > 0.9148551225662231) << 2) | ((features[11] > 0.06155303120613098) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.018309; scores[1] += 0.008035; scores[2] += 0.010275; break;
      case 1: scores[0] += 0.036218; scores[1] += -0.019259; scores[2] += -0.016959; break;
      case 2: scores[0] += 0.003516; scores[1] += 0.023766; scores[2] += -0.027282; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000171; scores[1] += 0.005690; scores[2] += -0.005861; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.007456; scores[1] += -0.007955; scores[2] += 0.000499; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.014737; scores[1] += 0.051831; scores[2] += -0.037094; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.022515; scores[1] += -0.041307; scores[2] += 0.018791; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 167 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[43] > 0.7663043737411499) << 1) | ((features[10] > 6.366666793823242) << 2) | ((features[13] > 0.9272486567497253) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.031601; scores[1] += -0.011399; scores[2] += -0.020203; break;
      case 1: scores[0] += -0.005226; scores[1] += -0.000847; scores[2] += 0.006074; break;
      case 2: scores[0] += -0.004327; scores[1] += -0.008771; scores[2] += 0.013098; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.006307; scores[1] += 0.001679; scores[2] += 0.004627; break;
      case 5: scores[0] += -0.003523; scores[1] += 0.032392; scores[2] += -0.028869; break;
      case 6: scores[0] += -0.000373; scores[1] += 0.020633; scores[2] += -0.020261; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.031636; scores[1] += 0.053894; scores[2] += -0.022257; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.007877; scores[1] += 0.001012; scores[2] += -0.008889; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.003591; scores[1] += -0.006725; scores[2] += 0.003134; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.008222; scores[1] += 0.008692; scores[2] += -0.000470; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 168 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[31] > 0.5) << 1) | ((features[43] > 0.9285714626312256) << 2) | ((features[10] > 7.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.008206; scores[1] += 0.002579; scores[2] += 0.005626; break;
      case 1: scores[0] += -0.000254; scores[1] += -0.010424; scores[2] += 0.010678; break;
      case 2: scores[0] += 0.005504; scores[1] += 0.017325; scores[2] += -0.022830; break;
      case 3: scores[0] += -0.001904; scores[1] += -0.014589; scores[2] += 0.016493; break;
      case 4: scores[0] += 0.011491; scores[1] += -0.005891; scores[2] += -0.005600; break;
      case 5: scores[0] += -0.002793; scores[1] += -0.003737; scores[2] += 0.006530; break;
      case 6: scores[0] += -0.014542; scores[1] += 0.020357; scores[2] += -0.005815; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000421; scores[1] += -0.001024; scores[2] += 0.001444; break;
      case 9: scores[0] += -0.000306; scores[1] += -0.002805; scores[2] += 0.003111; break;
      case 10: scores[0] += 0.002513; scores[1] += -0.006324; scores[2] += 0.003811; break;
      case 11: scores[0] += 0.006988; scores[1] += -0.004090; scores[2] += -0.002898; break;
      case 12: scores[0] += -0.011957; scores[1] += 0.026790; scores[2] += -0.014833; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002259; scores[1] += -0.022798; scores[2] += 0.025056; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 169 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8495475053787231) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[43] > 0.38083165884017944) << 2) | ((features[13] > 0.9148551225662231) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000952; scores[1] += -0.001033; scores[2] += 0.001985; break;
      case 1: scores[0] += -0.005905; scores[1] += 0.051823; scores[2] += -0.045918; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.010313; scores[1] += 0.026962; scores[2] += -0.016649; break;
      case 5: scores[0] += -0.002874; scores[1] += -0.008637; scores[2] += 0.011511; break;
      case 6: scores[0] += -0.002417; scores[1] += -0.022938; scores[2] += 0.025355; break;
      case 7: scores[0] += -0.001511; scores[1] += 0.009132; scores[2] += -0.007622; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.003096; scores[1] += -0.001436; scores[2] += -0.001659; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.002037; scores[1] += -0.015195; scores[2] += 0.017232; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.001900; scores[1] += 0.003446; scores[2] += -0.005346; break;
    }
  }

  // Tree 170 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[13] > 0.011904762126505375) << 1) | ((features[44] > 0.550000011920929) << 2) | ((features[10] > 8.875) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004535; scores[1] += 0.005967; scores[2] += -0.010502; break;
      case 1: scores[0] += -0.002636; scores[1] += -0.020042; scores[2] += 0.022677; break;
      case 2: scores[0] += -0.002396; scores[1] += -0.002681; scores[2] += 0.005077; break;
      case 3: scores[0] += -0.005231; scores[1] += 0.039458; scores[2] += -0.034227; break;
      case 4: scores[0] += -0.000348; scores[1] += 0.001870; scores[2] += -0.001522; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000371; scores[1] += 0.020115; scores[2] += -0.019744; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.003742; scores[1] += -0.013056; scores[2] += 0.009314; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000873; scores[1] += 0.004958; scores[2] += -0.005831; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003453; scores[1] += 0.006405; scores[2] += -0.002952; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 171 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[11] > 0.13840997219085693) << 1) | ((features[33] > 0.5) << 2) | ((features[10] > 7.4166669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006200; scores[1] += -0.001532; scores[2] += -0.004668; break;
      case 1: scores[0] += -0.002256; scores[1] += 0.014278; scores[2] += -0.012021; break;
      case 2: scores[0] += 0.014854; scores[1] += -0.046207; scores[2] += 0.031354; break;
      case 3: scores[0] += -0.018884; scores[1] += 0.014577; scores[2] += 0.004307; break;
      case 4: scores[0] += -0.009348; scores[1] += 0.012615; scores[2] += -0.003267; break;
      case 5: scores[0] += -0.002710; scores[1] += 0.009706; scores[2] += -0.006996; break;
      case 6: scores[0] += -0.004630; scores[1] += 0.035242; scores[2] += -0.030611; break;
      case 7: scores[0] += -0.000838; scores[1] += -0.019184; scores[2] += 0.020022; break;
      case 8: scores[0] += -0.002210; scores[1] += -0.000853; scores[2] += 0.003063; break;
      case 9: scores[0] += -0.006209; scores[1] += 0.052126; scores[2] += -0.045917; break;
      case 10: scores[0] += 0.032705; scores[1] += -0.014583; scores[2] += -0.018122; break;
      case 11: scores[0] += -0.003676; scores[1] += -0.013036; scores[2] += 0.016712; break;
      case 12: scores[0] += -0.005890; scores[1] += -0.000022; scores[2] += 0.005912; break;
      case 13: scores[0] += -0.006168; scores[1] += -0.007227; scores[2] += 0.013395; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.018446; scores[1] += -0.007707; scores[2] += -0.010739; break;
    }
  }

  // Tree 172 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[10] > 7.633333206176758) << 2) | ((features[43] > 0.8321678638458252) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.015290; scores[1] += 0.005517; scores[2] += 0.009773; break;
      case 1: scores[0] += 0.031359; scores[1] += -0.016764; scores[2] += -0.014596; break;
      case 2: scores[0] += -0.012906; scores[1] += 0.029166; scores[2] += -0.016260; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.001856; scores[1] += -0.001228; scores[2] += -0.000628; break;
      case 5: scores[0] += 0.008782; scores[1] += -0.004411; scores[2] += -0.004371; break;
      case 6: scores[0] += -0.001975; scores[1] += 0.030537; scores[2] += -0.028561; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.004443; scores[1] += -0.005340; scores[2] += 0.000897; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.004154; scores[1] += -0.013703; scores[2] += 0.017856; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.007779; scores[1] += 0.017447; scores[2] += -0.009668; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.012305; scores[1] += 0.023106; scores[2] += -0.010801; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 173 (depth=4)
  {
    const leafIdx = ((features[11] > 0.027402402833104134) << 0) | ((features[10] > 7.7083330154418945) << 1) | ((features[11] > 0.0635080635547638) << 2) | ((features[13] > 0.8973684310913086) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005082; scores[1] += -0.004932; scores[2] += -0.000150; break;
      case 1: scores[0] += -0.004750; scores[1] += 0.040843; scores[2] += -0.036093; break;
      case 2: scores[0] += -0.010586; scores[1] += 0.012182; scores[2] += -0.001596; break;
      case 3: scores[0] += 0.003453; scores[1] += -0.023415; scores[2] += 0.019962; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.031819; scores[1] += 0.015926; scores[2] += 0.015893; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.016455; scores[1] += -0.015743; scores[2] += -0.000712; break;
      case 8: scores[0] += 0.003764; scores[1] += -0.000920; scores[2] += -0.002845; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.002913; scores[1] += 0.003770; scores[2] += -0.006683; break;
      case 11: scores[0] += -0.012375; scores[1] += 0.030177; scores[2] += -0.017802; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.005368; scores[1] += 0.041176; scores[2] += -0.035808; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.012930; scores[1] += -0.033589; scores[2] += 0.020660; break;
    }
  }

  // Tree 174 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[43] > 0.8516483306884766) << 1) | ((features[10] > 7.550000190734863) << 2) | ((features[10] > 7.4166669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.012357; scores[1] += 0.008075; scores[2] += 0.004282; break;
      case 1: scores[0] += 0.030418; scores[1] += -0.016226; scores[2] += -0.014192; break;
      case 2: scores[0] += 0.006469; scores[1] += 0.000496; scores[2] += -0.006965; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.019660; scores[1] += -0.021209; scores[2] += 0.040869; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002229; scores[1] += -0.022027; scores[2] += 0.024256; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.001584; scores[1] += -0.000464; scores[2] += -0.001120; break;
      case 13: scores[0] += 0.008801; scores[1] += -0.004450; scores[2] += -0.004352; break;
      case 14: scores[0] += -0.010527; scores[1] += 0.023660; scores[2] += -0.013133; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 175 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[10] > 10.583333969116211) << 1) | ((features[13] > 0.9298029541969299) << 2) | ((features[43] > 0.043478261679410934) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.010410; scores[1] += 0.005911; scores[2] += 0.004498; break;
      case 1: scores[0] += 0.037062; scores[1] += -0.027298; scores[2] += -0.009763; break;
      case 2: scores[0] += 0.015893; scores[1] += -0.013465; scores[2] += -0.002427; break;
      case 3: scores[0] += -0.034445; scores[1] += 0.058980; scores[2] += -0.024535; break;
      case 4: scores[0] += 0.034972; scores[1] += 0.003815; scores[2] += -0.038787; break;
      case 5: scores[0] += -0.037236; scores[1] += 0.015968; scores[2] += 0.021268; break;
      case 6: scores[0] += 0.000733; scores[1] += 0.024150; scores[2] += -0.024883; break;
      case 7: scores[0] += 0.030793; scores[1] += -0.013300; scores[2] += -0.017493; break;
      case 8: scores[0] += -0.025470; scores[1] += 0.001936; scores[2] += 0.023534; break;
      case 9: scores[0] += -0.010066; scores[1] += 0.026951; scores[2] += -0.016885; break;
      case 10: scores[0] += -0.012952; scores[1] += 0.012206; scores[2] += 0.000746; break;
      case 11: scores[0] += -0.001034; scores[1] += 0.014946; scores[2] += -0.013912; break;
      case 12: scores[0] += -0.000958; scores[1] += -0.005103; scores[2] += 0.006061; break;
      case 13: scores[0] += 0.019161; scores[1] += -0.011316; scores[2] += -0.007845; break;
      case 14: scores[0] += -0.038642; scores[1] += 0.005188; scores[2] += 0.033455; break;
      case 15: scores[0] += -0.016666; scores[1] += -0.003710; scores[2] += 0.020376; break;
    }
  }

  // Tree 176 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[40] > 0.5) << 1) | ((features[43] > 0.22653958201408386) << 2) | ((features[10] > 6.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001695; scores[1] += 0.017146; scores[2] += -0.015451; break;
      case 1: scores[0] += 0.022967; scores[1] += -0.041755; scores[2] += 0.018789; break;
      case 2: scores[0] += -0.006556; scores[1] += 0.038143; scores[2] += -0.031586; break;
      case 3: scores[0] += -0.005221; scores[1] += -0.016932; scores[2] += 0.022154; break;
      case 4: scores[0] += -0.001682; scores[1] += -0.005679; scores[2] += 0.007361; break;
      case 5: scores[0] += -0.000875; scores[1] += 0.015343; scores[2] += -0.014468; break;
      case 6: scores[0] += -0.005144; scores[1] += -0.020259; scores[2] += 0.025404; break;
      case 7: scores[0] += -0.000531; scores[1] += 0.011112; scores[2] += -0.010581; break;
      case 8: scores[0] += 0.011638; scores[1] += -0.003585; scores[2] += -0.008053; break;
      case 9: scores[0] += 0.002386; scores[1] += -0.011962; scores[2] += 0.009576; break;
      case 10: scores[0] += -0.010199; scores[1] += 0.005340; scores[2] += 0.004860; break;
      case 11: scores[0] += -0.017694; scores[1] += 0.011288; scores[2] += 0.006406; break;
      case 12: scores[0] += -0.011023; scores[1] += 0.001965; scores[2] += 0.009058; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.018306; scores[1] += 0.006852; scores[2] += 0.011454; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 177 (depth=4)
  {
    const leafIdx = ((features[10] > 7.2916669845581055) << 0) | ((features[31] > 0.5) << 1) | ((features[43] > 0.24500000476837158) << 2) | ((features[13] > 0.9148551225662231) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004513; scores[1] += 0.002603; scores[2] += -0.007116; break;
      case 1: scores[0] += -0.003508; scores[1] += -0.000920; scores[2] += 0.004429; break;
      case 2: scores[0] += 0.003993; scores[1] += 0.017195; scores[2] += -0.021188; break;
      case 3: scores[0] += 0.008632; scores[1] += -0.000381; scores[2] += -0.008251; break;
      case 4: scores[0] += -0.013032; scores[1] += -0.025276; scores[2] += 0.038308; break;
      case 5: scores[0] += -0.013538; scores[1] += 0.026537; scores[2] += -0.012999; break;
      case 6: scores[0] += -0.018905; scores[1] += 0.014990; scores[2] += 0.003915; break;
      case 7: scores[0] += -0.006013; scores[1] += 0.015876; scores[2] += -0.009863; break;
      case 8: scores[0] += -0.008337; scores[1] += 0.023523; scores[2] += -0.015185; break;
      case 9: scores[0] += 0.012148; scores[1] += 0.007061; scores[2] += -0.019209; break;
      case 10: scores[0] += 0.039006; scores[1] += -0.058367; scores[2] += 0.019361; break;
      case 11: scores[0] += -0.006351; scores[1] += 0.010631; scores[2] += -0.004280; break;
      case 12: scores[0] += 0.006789; scores[1] += -0.004771; scores[2] += -0.002018; break;
      case 13: scores[0] += -0.008520; scores[1] += 0.028410; scores[2] += -0.019890; break;
      case 14: scores[0] += -0.019960; scores[1] += 0.041738; scores[2] += -0.021778; break;
      case 15: scores[0] += 0.018051; scores[1] += -0.064556; scores[2] += 0.046505; break;
    }
  }

  // Tree 178 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[9] > 2.5) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003430; scores[1] += -0.001213; scores[2] += -0.002217; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.024876; scores[1] += -0.018613; scores[2] += 0.043489; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001662; scores[1] += 0.007453; scores[2] += -0.005791; break;
      case 5: scores[0] += 0.013624; scores[1] += -0.034463; scores[2] += 0.020839; break;
      case 6: scores[0] += -0.014728; scores[1] += 0.006063; scores[2] += 0.008665; break;
      case 7: scores[0] += -0.005121; scores[1] += 0.033261; scores[2] += -0.028139; break;
      case 8: scores[0] += -0.009072; scores[1] += 0.022735; scores[2] += -0.013664; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.011435; scores[1] += 0.000772; scores[2] += -0.012207; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.002992; scores[1] += -0.007471; scores[2] += 0.004479; break;
      case 13: scores[0] += -0.009901; scores[1] += -0.010363; scores[2] += 0.020264; break;
      case 14: scores[0] += -0.009985; scores[1] += 0.024145; scores[2] += -0.014160; break;
      case 15: scores[0] += -0.002682; scores[1] += 0.015472; scores[2] += -0.012789; break;
    }
  }

  // Tree 179 (depth=4)
  {
    const leafIdx = ((features[40] > 0.5) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[13] > 0.7871376872062683) << 2) | ((features[13] > 0.9743589758872986) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000934; scores[1] += -0.004139; scores[2] += 0.005073; break;
      case 1: scores[0] += -0.000061; scores[1] += 0.001894; scores[2] += -0.001833; break;
      case 2: scores[0] += 0.013818; scores[1] += 0.005441; scores[2] += -0.019259; break;
      case 3: scores[0] += -0.039014; scores[1] += 0.017455; scores[2] += 0.021559; break;
      case 4: scores[0] += -0.017150; scores[1] += 0.057973; scores[2] += -0.040823; break;
      case 5: scores[0] += 0.021885; scores[1] += -0.033593; scores[2] += 0.011709; break;
      case 6: scores[0] += 0.075980; scores[1] += -0.090153; scores[2] += 0.014173; break;
      case 7: scores[0] += -0.014309; scores[1] += 0.032646; scores[2] += -0.018337; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.005252; scores[1] += 0.005123; scores[2] += -0.010375; break;
      case 13: scores[0] += -0.026163; scores[1] += 0.004203; scores[2] += 0.021961; break;
      case 14: scores[0] += 0.000097; scores[1] += -0.001710; scores[2] += 0.001614; break;
      case 15: scores[0] += -0.013670; scores[1] += 0.015233; scores[2] += -0.001564; break;
    }
  }

  // Tree 180 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[43] > 0.6651785373687744) << 1) | ((features[13] > 0.7295321226119995) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.009799; scores[1] += 0.002161; scores[2] += 0.007638; break;
      case 1: scores[0] += 0.028433; scores[1] += -0.015156; scores[2] += -0.013277; break;
      case 2: scores[0] += -0.001162; scores[1] += 0.007446; scores[2] += -0.006284; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.005385; scores[1] += 0.005488; scores[2] += -0.010873; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000383; scores[1] += 0.002566; scores[2] += -0.002183; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.009718; scores[1] += 0.011729; scores[2] += -0.021447; break;
      case 9: scores[0] += 0.010207; scores[1] += -0.005492; scores[2] += -0.004715; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.002114; scores[1] += -0.020006; scores[2] += 0.017892; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 181 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 6.775000095367432) << 1) | ((features[9] > 2.5) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006309; scores[1] += 0.016676; scores[2] += -0.022986; break;
      case 1: scores[0] += 0.013359; scores[1] += -0.003576; scores[2] += -0.009784; break;
      case 2: scores[0] += 0.004318; scores[1] += -0.002514; scores[2] += -0.001804; break;
      case 3: scores[0] += -0.016455; scores[1] += -0.017106; scores[2] += 0.033561; break;
      case 4: scores[0] += 0.008747; scores[1] += -0.009117; scores[2] += 0.000370; break;
      case 5: scores[0] += -0.007151; scores[1] += 0.000119; scores[2] += 0.007032; break;
      case 6: scores[0] += -0.003301; scores[1] += 0.003749; scores[2] += -0.000448; break;
      case 7: scores[0] += 0.006066; scores[1] += -0.013148; scores[2] += 0.007082; break;
      case 8: scores[0] += -0.003165; scores[1] += -0.044628; scores[2] += 0.047793; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.011117; scores[1] += -0.000991; scores[2] += 0.012108; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.011625; scores[1] += 0.021721; scores[2] += -0.010096; break;
      case 13: scores[0] += -0.000036; scores[1] += 0.001803; scores[2] += -0.001766; break;
      case 14: scores[0] += -0.014686; scores[1] += 0.011142; scores[2] += 0.003544; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 182 (depth=4)
  {
    const leafIdx = ((features[30] > 0.5) << 0) | ((features[43] > 0.1026315838098526) << 1) | ((features[14] > 0.5) << 2) | ((features[13] > 0.47913044691085815) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008915; scores[1] += -0.004387; scores[2] += -0.004527; break;
      case 1: scores[0] += 0.001468; scores[1] += -0.046519; scores[2] += 0.045051; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.015518; scores[1] += -0.044035; scores[2] += 0.059554; break;
      case 5: scores[0] += -0.001835; scores[1] += 0.047162; scores[2] += -0.045327; break;
      case 6: scores[0] += -0.013607; scores[1] += 0.035232; scores[2] += -0.021625; break;
      case 7: scores[0] += -0.001490; scores[1] += -0.041452; scores[2] += 0.042942; break;
      case 8: scores[0] += -0.011699; scores[1] += 0.029662; scores[2] += -0.017963; break;
      case 9: scores[0] += 0.015217; scores[1] += -0.042662; scores[2] += 0.027445; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.024508; scores[1] += -0.024293; scores[2] += -0.000215; break;
      case 13: scores[0] += 0.007150; scores[1] += -0.000776; scores[2] += -0.006374; break;
      case 14: scores[0] += -0.009629; scores[1] += 0.007635; scores[2] += 0.001993; break;
      case 15: scores[0] += -0.008425; scores[1] += 0.000729; scores[2] += 0.007696; break;
    }
  }

  // Tree 183 (depth=4)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[10] > 6.366666793823242) << 1) | ((features[9] > 2.5) << 2) | ((features[13] > 0.5521778464317322) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.019756; scores[1] += -0.013705; scores[2] += -0.006051; break;
      case 1: scores[0] += -0.000487; scores[1] += 0.003533; scores[2] += -0.003046; break;
      case 2: scores[0] += 0.012462; scores[1] += -0.007929; scores[2] += -0.004532; break;
      case 3: scores[0] += -0.031514; scores[1] += 0.024562; scores[2] += 0.006952; break;
      case 4: scores[0] += 0.016027; scores[1] += 0.000400; scores[2] += -0.016427; break;
      case 5: scores[0] += -0.008948; scores[1] += -0.031134; scores[2] += 0.040082; break;
      case 6: scores[0] += -0.017085; scores[1] += 0.004608; scores[2] += 0.012476; break;
      case 7: scores[0] += -0.000243; scores[1] += 0.015801; scores[2] += -0.015559; break;
      case 8: scores[0] += 0.000625; scores[1] += 0.000127; scores[2] += -0.000752; break;
      case 9: scores[0] += -0.012859; scores[1] += 0.012971; scores[2] += -0.000112; break;
      case 10: scores[0] += 0.007296; scores[1] += 0.007429; scores[2] += -0.014725; break;
      case 11: scores[0] += 0.001489; scores[1] += -0.047743; scores[2] += 0.046254; break;
      case 12: scores[0] += 0.007862; scores[1] += 0.013399; scores[2] += -0.021261; break;
      case 13: scores[0] += 0.011496; scores[1] += 0.002555; scores[2] += -0.014052; break;
      case 14: scores[0] += -0.001114; scores[1] += 0.003379; scores[2] += -0.002266; break;
      case 15: scores[0] += 0.005192; scores[1] += 0.013721; scores[2] += -0.018913; break;
    }
  }

  // Tree 184 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[43] > 0.1026315838098526) << 1) | ((features[43] > 0.09545454382896423) << 2) | ((features[44] > 0.550000011920929) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004736; scores[1] += -0.001299; scores[2] += -0.003437; break;
      case 1: scores[0] += -0.007880; scores[1] += 0.017859; scores[2] += -0.009979; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000552; scores[1] += -0.032041; scores[2] += 0.032594; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.011064; scores[1] += 0.001402; scores[2] += 0.009661; break;
      case 7: scores[0] += -0.000337; scores[1] += 0.003017; scores[2] += -0.002680; break;
      case 8: scores[0] += -0.000321; scores[1] += 0.001652; scores[2] += -0.001331; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002842; scores[1] += 0.023217; scores[2] += -0.020376; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 185 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.09545454382896423) << 1) | ((features[13] > 0.1026315838098526) << 2) | ((features[9] > 1.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.032956; scores[1] += -0.036308; scores[2] += 0.003352; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.004300; scores[1] += 0.006317; scores[2] += -0.010617; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.029515; scores[1] += 0.020821; scores[2] += 0.008693; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000561; scores[1] += -0.031377; scores[2] += 0.031939; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003786; scores[1] += -0.001111; scores[2] += 0.004897; break;
      case 15: scores[0] += 0.032331; scores[1] += -0.017254; scores[2] += -0.015077; break;
    }
  }

  // Tree 186 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[13] > 0.4258241653442383) << 1) | ((features[43] > 0.15894736349582672) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010607; scores[1] += -0.009878; scores[2] += -0.000729; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.004896; scores[1] += 0.004439; scores[2] += -0.009335; break;
      case 4: scores[0] += -0.012854; scores[1] += 0.017788; scores[2] += -0.004934; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.004529; scores[1] += -0.017442; scores[2] += 0.021971; break;
      case 8: scores[0] += -0.013753; scores[1] += 0.017856; scores[2] += -0.004103; break;
      case 9: scores[0] += -0.001730; scores[1] += -0.041513; scores[2] += 0.043243; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.007196; scores[1] += -0.010226; scores[2] += 0.003030; break;
      case 12: scores[0] += -0.014517; scores[1] += -0.012079; scores[2] += 0.026596; break;
      case 13: scores[0] += -0.000194; scores[1] += -0.008465; scores[2] += 0.008659; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.011633; scores[1] += 0.011567; scores[2] += 0.000065; break;
    }
  }

  // Tree 187 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8164982795715332) << 0) | ((features[14] > 0.5) << 1) | ((features[34] > 0.05000000074505806) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010735; scores[1] += -0.015290; scores[2] += 0.004555; break;
      case 1: scores[0] += -0.018892; scores[1] += 0.032318; scores[2] += -0.013426; break;
      case 2: scores[0] += -0.024845; scores[1] += 0.027926; scores[2] += -0.003082; break;
      case 3: scores[0] += 0.038691; scores[1] += -0.034236; scores[2] += -0.004455; break;
      case 4: scores[0] += 0.011019; scores[1] += -0.011502; scores[2] += 0.000483; break;
      case 5: scores[0] += 0.026635; scores[1] += -0.022847; scores[2] += -0.003788; break;
      case 6: scores[0] += -0.014573; scores[1] += 0.017892; scores[2] += -0.003319; break;
      case 7: scores[0] += -0.001051; scores[1] += -0.006226; scores[2] += 0.007276; break;
      case 8: scores[0] += -0.009635; scores[1] += 0.012587; scores[2] += -0.002951; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.007688; scores[1] += -0.052845; scores[2] += 0.060534; break;
      case 11: scores[0] += -0.008975; scores[1] += 0.019793; scores[2] += -0.010818; break;
      case 12: scores[0] += 0.009492; scores[1] += -0.029221; scores[2] += 0.019729; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.009202; scores[1] += 0.010910; scores[2] += -0.001707; break;
      case 15: scores[0] += 0.008165; scores[1] += 0.012195; scores[2] += -0.020360; break;
    }
  }

  // Tree 188 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1889880895614624) << 0) | ((features[11] > 0.2124060094356537) << 1) | ((features[19] > 0.5) << 2) | ((features[13] > 0.6191683411598206) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.017209; scores[1] += 0.006594; scores[2] += 0.010614; break;
      case 1: scores[0] += -0.006926; scores[1] += 0.042340; scores[2] += -0.035414; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.024638; scores[1] += -0.015776; scores[2] += -0.008862; break;
      case 4: scores[0] += 0.012832; scores[1] += -0.007244; scores[2] += -0.005587; break;
      case 5: scores[0] += -0.006092; scores[1] += 0.021400; scores[2] += -0.015308; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000540; scores[1] += -0.010026; scores[2] += 0.009487; break;
      case 8: scores[0] += 0.002237; scores[1] += 0.001297; scores[2] += -0.003534; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000498; scores[1] += -0.000364; scores[2] += -0.000134; break;
      case 12: scores[0] += 0.013577; scores[1] += 0.013552; scores[2] += -0.027129; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.002275; scores[1] += -0.002978; scores[2] += 0.005253; break;
    }
  }

  // Tree 189 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8164982795715332) << 0) | ((features[13] > 0.9148551225662231) << 1) | ((features[10] > 6.099999904632568) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.031577; scores[1] += -0.007891; scores[2] += -0.023686; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.024749; scores[1] += 0.031101; scores[2] += -0.006352; break;
      case 4: scores[0] += -0.003021; scores[1] += 0.001351; scores[2] += 0.001670; break;
      case 5: scores[0] += 0.016271; scores[1] += 0.011276; scores[2] += -0.027547; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000680; scores[1] += 0.004684; scores[2] += -0.005365; break;
      case 8: scores[0] += -0.018822; scores[1] += -0.005762; scores[2] += 0.024584; break;
      case 9: scores[0] += -0.009936; scores[1] += -0.000107; scores[2] += 0.010043; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.003281; scores[1] += 0.005173; scores[2] += -0.008454; break;
      case 12: scores[0] += -0.008975; scores[1] += 0.001244; scores[2] += 0.007731; break;
      case 13: scores[0] += 0.004969; scores[1] += 0.037004; scores[2] += -0.041973; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.004037; scores[1] += -0.010902; scores[2] += 0.006865; break;
    }
  }

  // Tree 190 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[43] > 0.2952069640159607) << 1) | ((features[9] > 2.5) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005827; scores[1] += -0.006968; scores[2] += 0.001141; break;
      case 1: scores[0] += -0.005075; scores[1] += 0.024754; scores[2] += -0.019679; break;
      case 2: scores[0] += 0.006370; scores[1] += 0.008533; scores[2] += -0.014903; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001392; scores[1] += -0.003590; scores[2] += 0.004982; break;
      case 5: scores[0] += -0.012154; scores[1] += 0.048766; scores[2] += -0.036612; break;
      case 6: scores[0] += -0.005154; scores[1] += -0.001889; scores[2] += 0.007043; break;
      case 7: scores[0] += -0.000415; scores[1] += 0.003782; scores[2] += -0.003366; break;
      case 8: scores[0] += -0.014406; scores[1] += -0.004716; scores[2] += 0.019122; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.015902; scores[1] += -0.001961; scores[2] += 0.017863; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.004374; scores[1] += 0.008293; scores[2] += -0.012667; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.001903; scores[1] += -0.001926; scores[2] += 0.003829; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 191 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[0] > 0.5) << 2) | ((features[13] > 0.5285947918891907) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.016807; scores[1] += -0.008998; scores[2] += -0.007809; break;
      case 1: scores[0] += -0.000332; scores[1] += 0.003071; scores[2] += -0.002739; break;
      case 2: scores[0] += -0.016643; scores[1] += 0.007720; scores[2] += 0.008923; break;
      case 3: scores[0] += -0.001200; scores[1] += 0.004696; scores[2] += -0.003497; break;
      case 4: scores[0] += -0.002300; scores[1] += -0.016345; scores[2] += 0.018645; break;
      case 5: scores[0] += -0.001470; scores[1] += -0.010048; scores[2] += 0.011519; break;
      case 6: scores[0] += 0.015416; scores[1] += -0.022468; scores[2] += 0.007052; break;
      case 7: scores[0] += -0.005301; scores[1] += 0.022723; scores[2] += -0.017422; break;
      case 8: scores[0] += 0.003135; scores[1] += 0.006427; scores[2] += -0.009563; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000268; scores[1] += 0.002335; scores[2] += -0.002067; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.036414; scores[1] += 0.007797; scores[2] += -0.044210; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 192 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[9] > 1.5) << 1) | ((features[10] > 6.449999809265137) << 2) | ((features[10] > 4.900000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.032034; scores[1] += 0.009794; scores[2] += 0.022240; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.015817; scores[1] += 0.012104; scores[2] += 0.003713; break;
      case 3: scores[0] += -0.004572; scores[1] += 0.015700; scores[2] += -0.011128; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.024065; scores[1] += -0.017410; scores[2] += -0.006655; break;
      case 9: scores[0] += 0.013203; scores[1] += -0.003522; scores[2] += -0.009682; break;
      case 10: scores[0] += 0.017790; scores[1] += -0.002314; scores[2] += -0.015477; break;
      case 11: scores[0] += -0.001741; scores[1] += -0.016751; scores[2] += 0.018493; break;
      case 12: scores[0] += 0.014339; scores[1] += 0.006917; scores[2] += -0.021257; break;
      case 13: scores[0] += -0.016123; scores[1] += -0.017192; scores[2] += 0.033315; break;
      case 14: scores[0] += -0.008457; scores[1] += 0.003358; scores[2] += 0.005099; break;
      case 15: scores[0] += 0.005798; scores[1] += -0.011045; scores[2] += 0.005247; break;
    }
  }

  // Tree 193 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[13] > 0.4721362292766571) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003976; scores[1] += 0.001171; scores[2] += -0.005147; break;
      case 1: scores[0] += -0.001956; scores[1] += 0.004165; scores[2] += -0.002209; break;
      case 2: scores[0] += -0.008725; scores[1] += 0.007337; scores[2] += 0.001388; break;
      case 3: scores[0] += -0.007557; scores[1] += -0.016582; scores[2] += 0.024138; break;
      case 4: scores[0] += 0.000599; scores[1] += 0.002719; scores[2] += -0.003317; break;
      case 5: scores[0] += 0.024292; scores[1] += -0.015727; scores[2] += -0.008566; break;
      case 6: scores[0] += -0.004565; scores[1] += -0.002123; scores[2] += 0.006689; break;
      case 7: scores[0] += 0.008932; scores[1] += 0.002342; scores[2] += -0.011274; break;
      case 8: scores[0] += -0.002339; scores[1] += -0.016122; scores[2] += 0.018461; break;
      case 9: scores[0] += -0.001502; scores[1] += -0.009984; scores[2] += 0.011486; break;
      case 10: scores[0] += 0.016313; scores[1] += -0.012589; scores[2] += -0.003725; break;
      case 11: scores[0] += -0.018522; scores[1] += -0.000992; scores[2] += 0.019514; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.028482; scores[1] += -0.009753; scores[2] += -0.018729; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 194 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 6.7083330154418945) << 1) | ((features[43] > 0.6651785373687744) << 2) | ((features[13] > 0.9354166984558105) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.015670; scores[1] += -0.007896; scores[2] += -0.007774; break;
      case 1: scores[0] += -0.001738; scores[1] += -0.015121; scores[2] += 0.016859; break;
      case 2: scores[0] += -0.001850; scores[1] += 0.001600; scores[2] += 0.000250; break;
      case 3: scores[0] += -0.000311; scores[1] += -0.008712; scores[2] += 0.009022; break;
      case 4: scores[0] += -0.005370; scores[1] += -0.005598; scores[2] += 0.010968; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000327; scores[1] += 0.019015; scores[2] += -0.018688; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.032031; scores[1] += 0.053946; scores[2] += -0.021915; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001651; scores[1] += -0.008610; scores[2] += 0.010261; break;
      case 11: scores[0] += 0.006196; scores[1] += -0.003714; scores[2] += -0.002482; break;
      case 12: scores[0] += -0.000208; scores[1] += -0.003175; scores[2] += 0.003382; break;
      case 13: scores[0] += 0.010172; scores[1] += 0.008793; scores[2] += -0.018965; break;
      case 14: scores[0] += 0.003124; scores[1] += 0.008549; scores[2] += -0.011674; break;
      case 15: scores[0] += -0.015859; scores[1] += -0.016931; scores[2] += 0.032790; break;
    }
  }

  // Tree 195 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5345238447189331) << 0) | ((features[13] > 0.5370879173278809) << 1) | ((features[11] > 0.028991596773266792) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002963; scores[1] += -0.001583; scores[2] += -0.001380; break;
      case 1: scores[0] += -0.000813; scores[1] += 0.023689; scores[2] += -0.022876; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.000703; scores[1] += 0.004788; scores[2] += -0.004085; break;
      case 4: scores[0] += 0.003537; scores[1] += -0.008106; scores[2] += 0.004569; break;
      case 5: scores[0] += 0.015804; scores[1] += -0.010148; scores[2] += -0.005656; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.011668; scores[1] += -0.002950; scores[2] += -0.008719; break;
      case 8: scores[0] += -0.012225; scores[1] += 0.029986; scores[2] += -0.017761; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.005825; scores[1] += -0.012240; scores[2] += 0.006415; break;
      case 12: scores[0] += -0.003943; scores[1] += -0.026515; scores[2] += 0.030458; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.000682; scores[1] += 0.024069; scores[2] += -0.023387; break;
    }
  }

  // Tree 196 (depth=4)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[10] > 10.833333969116211) << 1) | ((features[22] > 0.5) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010797; scores[1] += -0.002392; scores[2] += -0.008405; break;
      case 1: scores[0] += 0.008134; scores[1] += -0.003943; scores[2] += -0.004191; break;
      case 2: scores[0] += -0.002189; scores[1] += -0.004028; scores[2] += 0.006217; break;
      case 3: scores[0] += -0.038414; scores[1] += 0.042703; scores[2] += -0.004289; break;
      case 4: scores[0] += -0.005243; scores[1] += -0.005187; scores[2] += 0.010430; break;
      case 5: scores[0] += -0.001477; scores[1] += -0.003110; scores[2] += 0.004586; break;
      case 6: scores[0] += -0.003762; scores[1] += 0.044166; scores[2] += -0.040404; break;
      case 7: scores[0] += 0.006894; scores[1] += -0.024069; scores[2] += 0.017175; break;
      case 8: scores[0] += -0.022429; scores[1] += -0.015206; scores[2] += 0.037635; break;
      case 9: scores[0] += -0.013123; scores[1] += 0.006249; scores[2] += 0.006874; break;
      case 10: scores[0] += -0.002534; scores[1] += -0.000850; scores[2] += 0.003385; break;
      case 11: scores[0] += -0.000699; scores[1] += 0.005415; scores[2] += -0.004716; break;
      case 12: scores[0] += 0.012201; scores[1] += 0.004420; scores[2] += -0.016621; break;
      case 13: scores[0] += -0.009756; scores[1] += 0.022254; scores[2] += -0.012498; break;
      case 14: scores[0] += -0.000945; scores[1] += -0.004561; scores[2] += 0.005506; break;
      case 15: scores[0] += -0.000902; scores[1] += 0.014794; scores[2] += -0.013892; break;
    }
  }

  // Tree 197 (depth=4)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[14] > 0.5) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000836; scores[1] += 0.005790; scores[2] += -0.006627; break;
      case 1: scores[0] += -0.021951; scores[1] += 0.004936; scores[2] += 0.017014; break;
      case 2: scores[0] += 0.065781; scores[1] += -0.046151; scores[2] += -0.019630; break;
      case 3: scores[0] += -0.037095; scores[1] += 0.017408; scores[2] += 0.019686; break;
      case 4: scores[0] += -0.000721; scores[1] += 0.001996; scores[2] += -0.001275; break;
      case 5: scores[0] += 0.030470; scores[1] += -0.045166; scores[2] += 0.014696; break;
      case 6: scores[0] += -0.012134; scores[1] += 0.002315; scores[2] += 0.009819; break;
      case 7: scores[0] += -0.016644; scores[1] += 0.035196; scores[2] += -0.018552; break;
      case 8: scores[0] += -0.020528; scores[1] += 0.001842; scores[2] += 0.018686; break;
      case 9: scores[0] += 0.019380; scores[1] += -0.007044; scores[2] += -0.012337; break;
      case 10: scores[0] += -0.002978; scores[1] += 0.014815; scores[2] += -0.011837; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.014972; scores[1] += 0.020619; scores[2] += -0.005647; break;
      case 13: scores[0] += -0.005527; scores[1] += -0.011384; scores[2] += 0.016912; break;
      case 14: scores[0] += -0.004168; scores[1] += 0.031818; scores[2] += -0.027651; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 198 (depth=4)
  {
    const leafIdx = ((features[43] > 0.23904761672019958) << 0) | ((features[33] > 0.5) << 1) | ((features[10] > 4.7083330154418945) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008813; scores[1] += 0.005912; scores[2] += -0.014725; break;
      case 1: scores[0] += -0.036128; scores[1] += 0.010643; scores[2] += 0.025485; break;
      case 2: scores[0] += -0.000636; scores[1] += -0.039550; scores[2] += 0.040186; break;
      case 3: scores[0] += -0.005046; scores[1] += 0.021148; scores[2] += -0.016103; break;
      case 4: scores[0] += 0.002283; scores[1] += -0.000828; scores[2] += -0.001456; break;
      case 5: scores[0] += 0.007062; scores[1] += -0.014245; scores[2] += 0.007183; break;
      case 6: scores[0] += -0.008573; scores[1] += 0.018612; scores[2] += -0.010039; break;
      case 7: scores[0] += -0.009382; scores[1] += -0.005188; scores[2] += 0.014571; break;
      case 8: scores[0] += -0.001813; scores[1] += 0.008395; scores[2] += -0.006582; break;
      case 9: scores[0] += -0.000889; scores[1] += 0.009094; scores[2] += -0.008205; break;
      case 10: scores[0] += -0.000534; scores[1] += 0.002399; scores[2] += -0.001865; break;
      case 11: scores[0] += -0.009731; scores[1] += 0.008311; scores[2] += 0.001420; break;
      case 12: scores[0] += -0.001554; scores[1] += 0.003121; scores[2] += -0.001567; break;
      case 13: scores[0] += 0.015343; scores[1] += 0.001844; scores[2] += -0.017187; break;
      case 14: scores[0] += 0.014473; scores[1] += -0.012191; scores[2] += -0.002282; break;
      case 15: scores[0] += -0.013381; scores[1] += -0.017129; scores[2] += 0.030511; break;
    }
  }

  // Tree 199 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8164982795715332) << 0) | ((features[22] > 0.5) << 1) | ((features[13] > 0.9183333516120911) << 2) | ((features[11] > 0.06486675888299942) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005116; scores[1] += -0.002149; scores[2] += 0.007265; break;
      case 1: scores[0] += -0.015286; scores[1] += 0.015656; scores[2] += -0.000371; break;
      case 2: scores[0] += -0.017953; scores[1] += 0.011978; scores[2] += 0.005975; break;
      case 3: scores[0] += 0.027078; scores[1] += 0.021471; scores[2] += -0.048548; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000658; scores[1] += 0.002234; scores[2] += -0.002893; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.005692; scores[1] += 0.000265; scores[2] += -0.005956; break;
      case 9: scores[0] += -0.011300; scores[1] += 0.039802; scores[2] += -0.028503; break;
      case 10: scores[0] += -0.012473; scores[1] += 0.003091; scores[2] += 0.009382; break;
      case 11: scores[0] += 0.015129; scores[1] += -0.008216; scores[2] += -0.006913; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.009048; scores[1] += -0.030923; scores[2] += 0.021876; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 200 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[13] > 0.4202037453651428) << 1) | ((features[13] > 0.4258241653442383) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001202; scores[1] += 0.004687; scores[2] += -0.005889; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.002360; scores[1] += 0.044204; scores[2] += -0.041845; break;
      case 3: scores[0] += -0.001530; scores[1] += -0.043673; scores[2] += 0.045203; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.000182; scores[1] += -0.004116; scores[2] += 0.004298; break;
      case 8: scores[0] += -0.022391; scores[1] += 0.009117; scores[2] += 0.013274; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.000151; scores[1] += 0.001813; scores[2] += -0.001662; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.002246; scores[1] += 0.006113; scores[2] += -0.003867; break;
    }
  }

  // Tree 201 (depth=4)
  {
    const leafIdx = ((features[43] > 0.24500000476837158) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[10] > 7.633333206176758) << 2) | ((features[34] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002266; scores[1] += 0.003093; scores[2] += -0.000827; break;
      case 1: scores[0] += -0.008713; scores[1] += -0.010694; scores[2] += 0.019408; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000973; scores[1] += 0.000571; scores[2] += -0.001544; break;
      case 5: scores[0] += -0.006570; scores[1] += 0.008331; scores[2] += -0.001760; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000591; scores[1] += 0.019897; scores[2] += -0.020488; break;
      case 9: scores[0] += -0.002099; scores[1] += 0.014713; scores[2] += -0.012614; break;
      case 10: scores[0] += 0.013454; scores[1] += -0.007612; scores[2] += -0.005842; break;
      case 11: scores[0] += -0.001007; scores[1] += 0.013989; scores[2] += -0.012983; break;
      case 12: scores[0] += 0.009828; scores[1] += 0.021057; scores[2] += -0.030885; break;
      case 13: scores[0] += -0.000050; scores[1] += 0.000638; scores[2] += -0.000588; break;
      case 14: scores[0] += -0.015109; scores[1] += -0.028185; scores[2] += 0.043294; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 202 (depth=4)
  {
    const leafIdx = ((features[40] > 0.5) << 0) | ((features[10] > 9.291666030883789) << 1) | ((features[4] > 0.5) << 2) | ((features[13] > 0.9183333516120911) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.021753; scores[1] += 0.012714; scores[2] += 0.009038; break;
      case 1: scores[0] += -0.005306; scores[1] += 0.005642; scores[2] += -0.000336; break;
      case 2: scores[0] += 0.018088; scores[1] += -0.005524; scores[2] += -0.012564; break;
      case 3: scores[0] += -0.013516; scores[1] += -0.001560; scores[2] += 0.015076; break;
      case 4: scores[0] += -0.011385; scores[1] += -0.045541; scores[2] += 0.056926; break;
      case 5: scores[0] += 0.029528; scores[1] += -0.015673; scores[2] += -0.013855; break;
      case 6: scores[0] += 0.029306; scores[1] += 0.004115; scores[2] += -0.033421; break;
      case 7: scores[0] += 0.012354; scores[1] += 0.004916; scores[2] += -0.017270; break;
      case 8: scores[0] += 0.029023; scores[1] += -0.025778; scores[2] += -0.003245; break;
      case 9: scores[0] += -0.040196; scores[1] += 0.028656; scores[2] += 0.011540; break;
      case 10: scores[0] += 0.008594; scores[1] += -0.001358; scores[2] += -0.007236; break;
      case 11: scores[0] += -0.014811; scores[1] += 0.001116; scores[2] += 0.013695; break;
      case 12: scores[0] += -0.000903; scores[1] += 0.005920; scores[2] += -0.005016; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.005316; scores[1] += 0.003543; scores[2] += -0.008859; break;
      case 15: scores[0] += 0.006965; scores[1] += -0.005645; scores[2] += -0.001319; break;
    }
  }

  // Tree 203 (depth=4)
  {
    const leafIdx = ((features[10] > 10.833333969116211) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 9.708333969116211) << 2) | ((features[13] > 0.8550419807434082) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005885; scores[1] += 0.002398; scores[2] += 0.003487; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.031533; scores[1] += -0.016036; scores[2] += -0.015497; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.003543; scores[1] += -0.015184; scores[2] += 0.011641; break;
      case 5: scores[0] += 0.004454; scores[1] += 0.001290; scores[2] += -0.005744; break;
      case 6: scores[0] += -0.011133; scores[1] += 0.009574; scores[2] += 0.001559; break;
      case 7: scores[0] += -0.027714; scores[1] += 0.039543; scores[2] += -0.011829; break;
      case 8: scores[0] += 0.000704; scores[1] += 0.008099; scores[2] += -0.008803; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.036635; scores[1] += -0.043594; scores[2] += 0.006959; break;
      case 13: scores[0] += -0.013700; scores[1] += 0.011639; scores[2] += 0.002061; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 204 (depth=4)
  {
    const leafIdx = ((features[31] > 0.5) << 0) | ((features[10] > 7.4166669845581055) << 1) | ((features[43] > 0.21807065606117249) << 2) | ((features[13] > 0.9023809432983398) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002746; scores[1] += 0.000491; scores[2] += -0.003236; break;
      case 1: scores[0] += 0.007544; scores[1] += 0.007968; scores[2] += -0.015513; break;
      case 2: scores[0] += -0.000443; scores[1] += -0.001594; scores[2] += 0.002036; break;
      case 3: scores[0] += 0.006214; scores[1] += -0.004113; scores[2] += -0.002102; break;
      case 4: scores[0] += -0.012786; scores[1] += -0.017860; scores[2] += 0.030646; break;
      case 5: scores[0] += -0.019666; scores[1] += 0.014821; scores[2] += 0.004846; break;
      case 6: scores[0] += -0.013560; scores[1] += 0.026679; scores[2] += -0.013119; break;
      case 7: scores[0] += 0.010261; scores[1] += 0.002040; scores[2] += -0.012301; break;
      case 8: scores[0] += -0.008452; scores[1] += 0.021980; scores[2] += -0.013528; break;
      case 9: scores[0] += 0.030963; scores[1] += -0.042565; scores[2] += 0.011602; break;
      case 10: scores[0] += 0.007820; scores[1] += 0.006252; scores[2] += -0.014072; break;
      case 11: scores[0] += -0.000735; scores[1] += 0.012114; scores[2] += -0.011379; break;
      case 12: scores[0] += 0.006080; scores[1] += -0.006606; scores[2] += 0.000526; break;
      case 13: scores[0] += -0.021907; scores[1] += 0.048336; scores[2] += -0.026429; break;
      case 14: scores[0] += -0.007926; scores[1] += 0.023767; scores[2] += -0.015841; break;
      case 15: scores[0] += 0.007131; scores[1] += -0.049998; scores[2] += 0.042867; break;
    }
  }

  // Tree 205 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 6.224999904632568) << 1) | ((features[13] > 0.22474747896194458) << 2) | ((features[43] > 0.20416666567325592) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.026001; scores[1] += -0.007790; scores[2] += -0.018211; break;
      case 1: scores[0] += -0.005971; scores[1] += -0.019193; scores[2] += 0.025165; break;
      case 2: scores[0] += -0.003892; scores[1] += 0.005820; scores[2] += -0.001928; break;
      case 3: scores[0] += -0.017358; scores[1] += 0.002913; scores[2] += 0.014445; break;
      case 4: scores[0] += -0.029951; scores[1] += 0.040178; scores[2] += -0.010227; break;
      case 5: scores[0] += 0.021352; scores[1] += -0.009786; scores[2] += -0.011566; break;
      case 6: scores[0] += 0.005476; scores[1] += -0.006165; scores[2] += 0.000689; break;
      case 7: scores[0] += 0.002371; scores[1] += -0.001930; scores[2] += -0.000440; break;
      case 8: scores[0] += -0.000164; scores[1] += 0.001364; scores[2] += -0.001200; break;
      case 9: scores[0] += -0.000509; scores[1] += -0.033890; scores[2] += 0.034398; break;
      case 10: scores[0] += 0.002001; scores[1] += -0.019064; scores[2] += 0.017062; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002780; scores[1] += -0.004422; scores[2] += 0.007203; break;
      case 13: scores[0] += -0.001222; scores[1] += 0.019524; scores[2] += -0.018302; break;
      case 14: scores[0] += -0.013012; scores[1] += 0.007294; scores[2] += 0.005718; break;
      case 15: scores[0] += -0.000280; scores[1] += 0.001294; scores[2] += -0.001014; break;
    }
  }

  // Tree 206 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[11] > 0.027402402833104134) << 1) | ((features[11] > 0.049390241503715515) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001757; scores[1] += -0.001351; scores[2] += -0.000405; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.011159; scores[1] += 0.019533; scores[2] += -0.008375; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.012060; scores[1] += -0.005133; scores[2] += -0.006927; break;
      case 7: scores[0] += -0.001849; scores[1] += 0.016495; scores[2] += -0.014646; break;
      case 8: scores[0] += -0.016497; scores[1] += 0.014771; scores[2] += 0.001727; break;
      case 9: scores[0] += -0.001808; scores[1] += 0.007543; scores[2] += -0.005734; break;
      case 10: scores[0] += -0.032331; scores[1] += -0.010885; scores[2] += 0.043216; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.001288; scores[1] += -0.001279; scores[2] += 0.002566; break;
      case 15: scores[0] += -0.006184; scores[1] += 0.006519; scores[2] += -0.000335; break;
    }
  }

  // Tree 207 (depth=4)
  {
    const leafIdx = ((features[47] > 0.550000011920929) << 0) | ((features[11] > 0.027402402833104134) << 1) | ((features[43] > 0.16333332657814026) << 2) | ((features[13] > 0.2198067605495453) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004364; scores[1] += 0.005193; scores[2] += -0.009557; break;
      case 1: scores[0] += 0.011368; scores[1] += -0.009299; scores[2] += -0.002069; break;
      case 2: scores[0] += -0.003615; scores[1] += -0.005553; scores[2] += 0.009168; break;
      case 3: scores[0] += 0.001325; scores[1] += -0.000570; scores[2] += -0.000755; break;
      case 4: scores[0] += -0.009512; scores[1] += -0.021688; scores[2] += 0.031200; break;
      case 5: scores[0] += -0.000931; scores[1] += 0.001417; scores[2] += -0.000486; break;
      case 6: scores[0] += 0.000843; scores[1] += 0.011362; scores[2] += -0.012205; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002631; scores[1] += 0.001018; scores[2] += -0.003649; break;
      case 9: scores[0] += -0.033962; scores[1] += 0.035131; scores[2] += -0.001170; break;
      case 10: scores[0] += 0.007686; scores[1] += -0.007534; scores[2] += -0.000152; break;
      case 11: scores[0] += 0.011131; scores[1] += -0.009033; scores[2] += -0.002098; break;
      case 12: scores[0] += -0.001318; scores[1] += -0.003864; scores[2] += 0.005183; break;
      case 13: scores[0] += -0.002506; scores[1] += 0.004992; scores[2] += -0.002486; break;
      case 14: scores[0] += -0.025430; scores[1] += 0.025773; scores[2] += -0.000343; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 208 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[43] > 0.21807065606117249) << 2) | ((features[13] > 0.9183333516120911) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003025; scores[1] += -0.001170; scores[2] += -0.001855; break;
      case 1: scores[0] += -0.008857; scores[1] += 0.019122; scores[2] += -0.010265; break;
      case 2: scores[0] += -0.007695; scores[1] += -0.012172; scores[2] += 0.019867; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.025798; scores[1] += 0.012982; scores[2] += 0.012816; break;
      case 7: scores[0] += -0.000220; scores[1] += 0.001868; scores[2] += -0.001648; break;
      case 8: scores[0] += 0.005808; scores[1] += 0.013531; scores[2] += -0.019339; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.025656; scores[1] += -0.044896; scores[2] += 0.019239; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002416; scores[1] += -0.003703; scores[2] += 0.006118; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 209 (depth=4)
  {
    const leafIdx = ((features[10] > 8.225000381469727) << 0) | ((features[13] > 0.9183333516120911) << 1) | ((features[9] > 3.5) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.017836; scores[1] += 0.005529; scores[2] += 0.012308; break;
      case 1: scores[0] += 0.006895; scores[1] += -0.000988; scores[2] += -0.005907; break;
      case 2: scores[0] += -0.002081; scores[1] += 0.006080; scores[2] += -0.003998; break;
      case 3: scores[0] += 0.004705; scores[1] += 0.000512; scores[2] += -0.005217; break;
      case 4: scores[0] += 0.016100; scores[1] += 0.004470; scores[2] += -0.020570; break;
      case 5: scores[0] += 0.002575; scores[1] += -0.005126; scores[2] += 0.002551; break;
      case 6: scores[0] += 0.077230; scores[1] += -0.088953; scores[2] += 0.011724; break;
      case 7: scores[0] += -0.018269; scores[1] += 0.025437; scores[2] += -0.007168; break;
      case 8: scores[0] += -0.014639; scores[1] += 0.011247; scores[2] += 0.003392; break;
      case 9: scores[0] += 0.011788; scores[1] += -0.010451; scores[2] += -0.001337; break;
      case 10: scores[0] += -0.005909; scores[1] += -0.002641; scores[2] += 0.008550; break;
      case 11: scores[0] += -0.019468; scores[1] += 0.001031; scores[2] += 0.018437; break;
      case 12: scores[0] += -0.028990; scores[1] += 0.007285; scores[2] += 0.021705; break;
      case 13: scores[0] += -0.023088; scores[1] += 0.022685; scores[2] += 0.000404; break;
      case 14: scores[0] += -0.010409; scores[1] += 0.025339; scores[2] += -0.014931; break;
      case 15: scores[0] += -0.016051; scores[1] += 0.018062; scores[2] += -0.002011; break;
    }
  }

  // Tree 210 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.9743589758872986) << 1) | ((features[43] > 0.8321678638458252) << 2) | ((features[13] > 0.9354166984558105) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001921; scores[1] += 0.001184; scores[2] += 0.000737; break;
      case 1: scores[0] += 0.032325; scores[1] += -0.017219; scores[2] += -0.015106; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.003390; scores[1] += -0.010641; scores[2] += 0.014031; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.032073; scores[1] += -0.027057; scores[2] += -0.005016; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.005431; scores[1] += 0.002421; scores[2] += 0.003010; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.001213; scores[1] += 0.000730; scores[2] += -0.001943; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 211 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[30] > 0.5) << 1) | ((features[31] > 0.5) << 2) | ((features[10] > 5.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.015342; scores[1] += 0.019954; scores[2] += -0.035296; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.005161; scores[1] += -0.031722; scores[2] += 0.036884; break;
      case 3: scores[0] += 0.007499; scores[1] += 0.004518; scores[2] += -0.012017; break;
      case 4: scores[0] += 0.018803; scores[1] += -0.007833; scores[2] += -0.010970; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003273; scores[1] += 0.007343; scores[2] += -0.004070; break;
      case 7: scores[0] += -0.011593; scores[1] += 0.019132; scores[2] += -0.007539; break;
      case 8: scores[0] += -0.005422; scores[1] += 0.001312; scores[2] += 0.004110; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.002747; scores[1] += -0.002645; scores[2] += -0.000101; break;
      case 11: scores[0] += 0.001220; scores[1] += 0.001870; scores[2] += -0.003090; break;
      case 12: scores[0] += 0.004897; scores[1] += 0.005701; scores[2] += -0.010598; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002520; scores[1] += -0.000246; scores[2] += 0.002767; break;
      case 15: scores[0] += -0.007414; scores[1] += -0.027160; scores[2] += 0.034574; break;
    }
  }

  // Tree 212 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[13] > 0.4721362292766571) << 1) | ((features[14] > 0.5) << 2) | ((features[10] > 9.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008136; scores[1] += -0.001017; scores[2] += -0.007119; break;
      case 1: scores[0] += -0.021698; scores[1] += -0.001363; scores[2] += 0.023060; break;
      case 2: scores[0] += -0.005071; scores[1] += -0.018346; scores[2] += 0.023417; break;
      case 3: scores[0] += 0.043227; scores[1] += -0.029422; scores[2] += -0.013805; break;
      case 4: scores[0] += -0.012430; scores[1] += 0.017643; scores[2] += -0.005213; break;
      case 5: scores[0] += -0.006033; scores[1] += -0.009211; scores[2] += 0.015244; break;
      case 6: scores[0] += -0.007471; scores[1] += -0.001118; scores[2] += 0.008590; break;
      case 7: scores[0] += -0.012444; scores[1] += 0.016025; scores[2] += -0.003581; break;
      case 8: scores[0] += 0.001728; scores[1] += -0.013260; scores[2] += 0.011533; break;
      case 9: scores[0] += -0.000589; scores[1] += -0.001883; scores[2] += 0.002471; break;
      case 10: scores[0] += -0.000189; scores[1] += 0.035971; scores[2] += -0.035782; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.003251; scores[1] += 0.006509; scores[2] += -0.009760; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.016566; scores[1] += -0.009864; scores[2] += -0.006701; break;
      case 15: scores[0] += -0.000686; scores[1] += 0.001569; scores[2] += -0.000883; break;
    }
  }

  // Tree 213 (depth=4)
  {
    const leafIdx = ((features[11] > 0.027402402833104134) << 0) | ((features[11] > 0.035098522901535034) << 1) | ((features[40] > 0.5) << 2) | ((features[10] > 7.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.013214; scores[1] += -0.004539; scores[2] += -0.008675; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.016671; scores[1] += 0.018333; scores[2] += -0.001662; break;
      case 4: scores[0] += -0.026597; scores[1] += 0.007644; scores[2] += 0.018953; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.017547; scores[1] += 0.015447; scores[2] += 0.002100; break;
      case 8: scores[0] += -0.007175; scores[1] += 0.000631; scores[2] += 0.006544; break;
      case 9: scores[0] += -0.005692; scores[1] += 0.031967; scores[2] += -0.026274; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.015141; scores[1] += -0.013667; scores[2] += -0.001474; break;
      case 12: scores[0] += -0.004408; scores[1] += 0.015087; scores[2] += -0.010679; break;
      case 13: scores[0] += -0.009344; scores[1] += -0.035203; scores[2] += 0.044548; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.003810; scores[1] += -0.001569; scores[2] += 0.005379; break;
    }
  }

  // Tree 214 (depth=4)
  {
    const leafIdx = ((features[10] > 10.833333969116211) << 0) | ((features[10] > 9.875) << 1) | ((features[13] > 0.13188406825065613) << 2) | ((features[38] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.009745; scores[1] += 0.017605; scores[2] += -0.007860; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.004301; scores[1] += -0.025890; scores[2] += 0.030191; break;
      case 3: scores[0] += -0.012044; scores[1] += 0.019881; scores[2] += -0.007837; break;
      case 4: scores[0] += -0.001450; scores[1] += -0.004097; scores[2] += 0.005547; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.027153; scores[1] += -0.014724; scores[2] += -0.012429; break;
      case 7: scores[0] += -0.011481; scores[1] += 0.012211; scores[2] += -0.000730; break;
      case 8: scores[0] += 0.012421; scores[1] += -0.017118; scores[2] += 0.004698; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.004860; scores[1] += 0.000839; scores[2] += 0.004021; break;
      case 11: scores[0] += 0.013686; scores[1] += -0.011793; scores[2] += -0.001893; break;
      case 12: scores[0] += 0.017390; scores[1] += 0.001656; scores[2] += -0.019046; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.013341; scores[1] += -0.007487; scores[2] += -0.005854; break;
      case 15: scores[0] += -0.002835; scores[1] += -0.007560; scores[2] += 0.010394; break;
    }
  }

  // Tree 215 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[27] > 0.5) << 1) | ((features[44] > 0.25) << 2) | ((features[10] > 7.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.029813; scores[1] += 0.009427; scores[2] += 0.020386; break;
      case 1: scores[0] += 0.010343; scores[1] += -0.016003; scores[2] += 0.005659; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.012032; scores[1] += -0.002628; scores[2] += -0.009404; break;
      case 4: scores[0] += -0.005816; scores[1] += 0.024517; scores[2] += -0.018701; break;
      case 5: scores[0] += -0.000277; scores[1] += 0.003367; scores[2] += -0.003091; break;
      case 6: scores[0] += -0.004047; scores[1] += 0.013119; scores[2] += -0.009072; break;
      case 7: scores[0] += -0.017796; scores[1] += -0.022455; scores[2] += 0.040251; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.004793; scores[1] += -0.001606; scores[2] += -0.003187; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.003603; scores[1] += 0.001711; scores[2] += 0.001892; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.005739; scores[1] += -0.003485; scores[2] += -0.002254; break;
    }
  }

  // Tree 216 (depth=4)
  {
    const leafIdx = ((features[10] > 6.449999809265137) << 0) | ((features[9] > 4.5) << 1) | ((features[11] > 0.028991596773266792) << 2) | ((features[11] > 0.08957219123840332) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005740; scores[1] += -0.005043; scores[2] += -0.000697; break;
      case 1: scores[0] += -0.002706; scores[1] += 0.002961; scores[2] += -0.000255; break;
      case 2: scores[0] += -0.004564; scores[1] += 0.023915; scores[2] += -0.019351; break;
      case 3: scores[0] += -0.000526; scores[1] += 0.004841; scores[2] += -0.004315; break;
      case 4: scores[0] += -0.005551; scores[1] += 0.040722; scores[2] += -0.035171; break;
      case 5: scores[0] += 0.003671; scores[1] += -0.013528; scores[2] += 0.009857; break;
      case 6: scores[0] += -0.003860; scores[1] += -0.007596; scores[2] += 0.011455; break;
      case 7: scores[0] += -0.003383; scores[1] += 0.030545; scores[2] += -0.027162; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.006587; scores[1] += 0.007599; scores[2] += -0.014187; break;
      case 13: scores[0] += -0.002704; scores[1] += 0.001144; scores[2] += 0.001560; break;
      case 14: scores[0] += -0.002322; scores[1] += 0.013738; scores[2] += -0.011416; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 217 (depth=4)
  {
    const leafIdx = ((features[43] > 0.20942983031272888) << 0) | ((features[13] > 0.2198067605495453) << 1) | ((features[34] > 0.3500000238418579) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004705; scores[1] += 0.009139; scores[2] += -0.013844; break;
      case 1: scores[0] += 0.002212; scores[1] += -0.004523; scores[2] += 0.002311; break;
      case 2: scores[0] += 0.002170; scores[1] += -0.003914; scores[2] += 0.001744; break;
      case 3: scores[0] += -0.006650; scores[1] += 0.001546; scores[2] += 0.005104; break;
      case 4: scores[0] += -0.016992; scores[1] += -0.012939; scores[2] += 0.029931; break;
      case 5: scores[0] += -0.000534; scores[1] += -0.032697; scores[2] += 0.033231; break;
      case 6: scores[0] += 0.021937; scores[1] += -0.028879; scores[2] += 0.006942; break;
      case 7: scores[0] += -0.000971; scores[1] += 0.015437; scores[2] += -0.014466; break;
      case 8: scores[0] += -0.017168; scores[1] += 0.000234; scores[2] += 0.016934; break;
      case 9: scores[0] += -0.000249; scores[1] += -0.019389; scores[2] += 0.019638; break;
      case 10: scores[0] += -0.001983; scores[1] += 0.012982; scores[2] += -0.010998; break;
      case 11: scores[0] += -0.001146; scores[1] += 0.000547; scores[2] += 0.000600; break;
      case 12: scores[0] += -0.002581; scores[1] += 0.015016; scores[2] += -0.012436; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003713; scores[1] += 0.026021; scores[2] += -0.022308; break;
      case 15: scores[0] += -0.000494; scores[1] += 0.007501; scores[2] += -0.007007; break;
    }
  }

  // Tree 218 (depth=4)
  {
    const leafIdx = ((features[10] > 5.0833330154418945) << 0) | ((features[27] > 0.5) << 1) | ((features[13] > 0.7871376872062683) << 2) | ((features[43] > 0.09545454382896423) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009903; scores[1] += 0.003983; scores[2] += -0.013886; break;
      case 1: scores[0] += 0.000319; scores[1] += -0.000598; scores[2] += 0.000279; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.012392; scores[1] += 0.011070; scores[2] += -0.023462; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.005650; scores[1] += -0.003392; scores[2] += -0.002259; break;
      case 8: scores[0] += -0.003365; scores[1] += -0.008693; scores[2] += 0.012058; break;
      case 9: scores[0] += -0.022467; scores[1] += 0.010992; scores[2] += 0.011476; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.000309; scores[1] += -0.008291; scores[2] += 0.008600; break;
      case 12: scores[0] += 0.004373; scores[1] += 0.005988; scores[2] += -0.010361; break;
      case 13: scores[0] += -0.008831; scores[1] += -0.000256; scores[2] += 0.009087; break;
      case 14: scores[0] += 0.000315; scores[1] += 0.015716; scores[2] += -0.016031; break;
      case 15: scores[0] += -0.005651; scores[1] += -0.029946; scores[2] += 0.035597; break;
    }
  }

  // Tree 219 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1889880895614624) << 0) | ((features[11] > 0.2124060094356537) << 1) | ((features[13] > 0.09545454382896423) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.027413; scores[1] += 0.019216; scores[2] += 0.008197; break;
      case 1: scores[0] += -0.004092; scores[1] += 0.004425; scores[2] += -0.000332; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.001448; scores[1] += 0.001078; scores[2] += 0.000370; break;
      case 4: scores[0] += -0.001078; scores[1] += -0.003378; scores[2] += 0.004456; break;
      case 5: scores[0] += -0.008959; scores[1] += 0.053199; scores[2] += -0.044240; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.013460; scores[1] += -0.019476; scores[2] += 0.006016; break;
      case 8: scores[0] += 0.027564; scores[1] += -0.034790; scores[2] += 0.007226; break;
      case 9: scores[0] += 0.000589; scores[1] += -0.000096; scores[2] += -0.000493; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.009213; scores[1] += -0.004826; scores[2] += -0.004386; break;
      case 12: scores[0] += 0.002756; scores[1] += 0.004692; scores[2] += -0.007449; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.003856; scores[1] += -0.001413; scores[2] += -0.002442; break;
    }
  }

  // Tree 220 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[44] > 0.25) << 2) | ((features[13] > 0.2928921580314636) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003074; scores[1] += -0.013763; scores[2] += 0.010688; break;
      case 1: scores[0] += -0.000661; scores[1] += 0.017180; scores[2] += -0.016519; break;
      case 2: scores[0] += 0.013276; scores[1] += 0.005571; scores[2] += -0.018847; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.023114; scores[1] += 0.018003; scores[2] += 0.005111; break;
      case 5: scores[0] += 0.014809; scores[1] += -0.002257; scores[2] += -0.012552; break;
      case 6: scores[0] += -0.011289; scores[1] += -0.023879; scores[2] += 0.035168; break;
      case 7: scores[0] += -0.023631; scores[1] += 0.034953; scores[2] += -0.011322; break;
      case 8: scores[0] += 0.004712; scores[1] += -0.002554; scores[2] += -0.002159; break;
      case 9: scores[0] += 0.022062; scores[1] += -0.009582; scores[2] += -0.012480; break;
      case 10: scores[0] += -0.011006; scores[1] += 0.003316; scores[2] += 0.007689; break;
      case 11: scores[0] += 0.006785; scores[1] += -0.018034; scores[2] += 0.011249; break;
      case 12: scores[0] += 0.002473; scores[1] += -0.005400; scores[2] += 0.002927; break;
      case 13: scores[0] += 0.003684; scores[1] += -0.003812; scores[2] += 0.000128; break;
      case 14: scores[0] += -0.013291; scores[1] += 0.025297; scores[2] += -0.012006; break;
      case 15: scores[0] += 0.002014; scores[1] += 0.031946; scores[2] += -0.033960; break;
    }
  }

  // Tree 221 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[10] > 9.708333969116211) << 1) | ((features[10] > 10.416666030883789) << 2) | ((features[13] > 0.9384469985961914) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008778; scores[1] += -0.005198; scores[2] += -0.003581; break;
      case 1: scores[0] += -0.010491; scores[1] += 0.019117; scores[2] += -0.008626; break;
      case 2: scores[0] += -0.004469; scores[1] += -0.016216; scores[2] += 0.020684; break;
      case 3: scores[0] += -0.001057; scores[1] += 0.002837; scores[2] += -0.001780; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.002473; scores[1] += 0.007352; scores[2] += -0.004879; break;
      case 7: scores[0] += -0.004492; scores[1] += 0.013593; scores[2] += -0.009101; break;
      case 8: scores[0] += -0.010472; scores[1] += 0.014865; scores[2] += -0.004393; break;
      case 9: scores[0] += -0.003663; scores[1] += 0.003179; scores[2] += 0.000484; break;
      case 10: scores[0] += 0.014163; scores[1] += -0.036508; scores[2] += 0.022346; break;
      case 11: scores[0] += 0.044201; scores[1] += -0.029089; scores[2] += -0.015112; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.005090; scores[1] += 0.009992; scores[2] += -0.004902; break;
      case 15: scores[0] += -0.020917; scores[1] += 0.001268; scores[2] += 0.019649; break;
    }
  }

  // Tree 222 (depth=4)
  {
    const leafIdx = ((features[13] > 0.521164059638977) << 0) | ((features[0] > 0.5) << 1) | ((features[44] > 0.3500000238418579) << 2) | ((features[34] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.007931; scores[1] += 0.001368; scores[2] += 0.006563; break;
      case 1: scores[0] += -0.003675; scores[1] += 0.003200; scores[2] += 0.000475; break;
      case 2: scores[0] += 0.010637; scores[1] += -0.022846; scores[2] += 0.012209; break;
      case 3: scores[0] += 0.042765; scores[1] += -0.009641; scores[2] += -0.033124; break;
      case 4: scores[0] += -0.022177; scores[1] += 0.019110; scores[2] += 0.003067; break;
      case 5: scores[0] += 0.019725; scores[1] += -0.003965; scores[2] += -0.015759; break;
      case 6: scores[0] += 0.003065; scores[1] += -0.009869; scores[2] += 0.006804; break;
      case 7: scores[0] += -0.007986; scores[1] += 0.021033; scores[2] += -0.013046; break;
      case 8: scores[0] += -0.003889; scores[1] += 0.025305; scores[2] += -0.021416; break;
      case 9: scores[0] += -0.006000; scores[1] += 0.025425; scores[2] += -0.019424; break;
      case 10: scores[0] += 0.017027; scores[1] += 0.004777; scores[2] += -0.021803; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.007783; scores[1] += -0.009618; scores[2] += 0.001835; break;
      case 13: scores[0] += 0.008752; scores[1] += -0.003682; scores[2] += -0.005070; break;
      case 14: scores[0] += -0.018900; scores[1] += -0.001067; scores[2] += 0.019966; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 223 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[10] > 9.583333969116211) << 1) | ((features[10] > 7.900000095367432) << 2) | ((features[13] > 0.8164982795715332) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.009301; scores[1] += 0.002905; scores[2] += 0.006396; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.009285; scores[1] += -0.003634; scores[2] += -0.005651; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.008295; scores[1] += 0.001328; scores[2] += 0.006967; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.001796; scores[1] += 0.013861; scores[2] += -0.012065; break;
      case 9: scores[0] += 0.003327; scores[1] += -0.003321; scores[2] += -0.000006; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.015299; scores[1] += -0.001345; scores[2] += -0.013954; break;
      case 13: scores[0] += -0.028439; scores[1] += 0.046171; scores[2] += -0.017733; break;
      case 14: scores[0] += 0.000993; scores[1] += 0.000759; scores[2] += -0.001752; break;
      case 15: scores[0] += 0.015902; scores[1] += -0.018691; scores[2] += 0.002790; break;
    }
  }

  // Tree 224 (depth=4)
  {
    const leafIdx = ((features[10] > 10.416666030883789) << 0) | ((features[34] > 0.25) << 1) | ((features[11] > 0.06936648488044739) << 2) | ((features[13] > 0.5797962546348572) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.014361; scores[1] += 0.005345; scores[2] += 0.009016; break;
      case 1: scores[0] += 0.010741; scores[1] += -0.001412; scores[2] += -0.009329; break;
      case 2: scores[0] += 0.019996; scores[1] += -0.011804; scores[2] += -0.008192; break;
      case 3: scores[0] += -0.006534; scores[1] += -0.008012; scores[2] += 0.014545; break;
      case 4: scores[0] += 0.007410; scores[1] += -0.004928; scores[2] += -0.002481; break;
      case 5: scores[0] += 0.001564; scores[1] += -0.009856; scores[2] += 0.008292; break;
      case 6: scores[0] += 0.018056; scores[1] += -0.005340; scores[2] += -0.012716; break;
      case 7: scores[0] += -0.026536; scores[1] += 0.056143; scores[2] += -0.029607; break;
      case 8: scores[0] += -0.002071; scores[1] += -0.003018; scores[2] += 0.005089; break;
      case 9: scores[0] += -0.008741; scores[1] += 0.015472; scores[2] += -0.006731; break;
      case 10: scores[0] += -0.002577; scores[1] += 0.006675; scores[2] += -0.004099; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.027132; scores[1] += 0.006331; scores[2] += -0.033463; break;
      case 13: scores[0] += 0.012583; scores[1] += -0.029982; scores[2] += 0.017399; break;
      case 14: scores[0] += -0.005463; scores[1] += -0.011116; scores[2] += 0.016579; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 225 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[10] > 10.583333969116211) << 1) | ((features[11] > 0.08957219123840332) << 2) | ((features[25] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.011146; scores[1] += 0.004595; scores[2] += 0.006551; break;
      case 1: scores[0] += 0.040037; scores[1] += -0.028254; scores[2] += -0.011783; break;
      case 2: scores[0] += 0.013772; scores[1] += -0.009379; scores[2] += -0.004393; break;
      case 3: scores[0] += -0.011051; scores[1] += -0.016001; scores[2] += 0.027052; break;
      case 4: scores[0] += -0.001317; scores[1] += 0.030423; scores[2] += -0.029106; break;
      case 5: scores[0] += -0.020749; scores[1] += -0.014810; scores[2] += 0.035559; break;
      case 6: scores[0] += 0.000933; scores[1] += -0.005386; scores[2] += 0.004453; break;
      case 7: scores[0] += -0.014019; scores[1] += 0.051293; scores[2] += -0.037274; break;
      case 8: scores[0] += 0.004210; scores[1] += -0.004789; scores[2] += 0.000579; break;
      case 9: scores[0] += -0.007761; scores[1] += 0.014680; scores[2] += -0.006919; break;
      case 10: scores[0] += -0.011055; scores[1] += 0.011069; scores[2] += -0.000013; break;
      case 11: scores[0] += 0.006220; scores[1] += 0.014104; scores[2] += -0.020324; break;
      case 12: scores[0] += -0.017571; scores[1] += 0.004005; scores[2] += 0.013565; break;
      case 13: scores[0] += 0.023657; scores[1] += -0.005083; scores[2] += -0.018574; break;
      case 14: scores[0] += 0.019584; scores[1] += -0.029329; scores[2] += 0.009745; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 226 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8321678638458252) << 0) | ((features[43] > 0.6651785373687744) << 1) | ((features[10] > 11.125) << 2) | ((features[10] > 12.833333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002940; scores[1] += -0.001640; scores[2] += -0.001300; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.001762; scores[1] += 0.016260; scores[2] += -0.014498; break;
      case 3: scores[0] += 0.003032; scores[1] += 0.000649; scores[2] += -0.003680; break;
      case 4: scores[0] += 0.004712; scores[1] += -0.007621; scores[2] += 0.002909; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.010729; scores[1] += -0.023392; scores[2] += 0.034121; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.008443; scores[1] += 0.011460; scores[2] += -0.003017; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.009188; scores[1] += 0.017579; scores[2] += -0.008391; break;
    }
  }

  // Tree 227 (depth=4)
  {
    const leafIdx = ((features[4] > 0.5) << 0) | ((features[10] > 8.875) << 1) | ((features[13] > 0.679618775844574) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009008; scores[1] += -0.000259; scores[2] += -0.008748; break;
      case 1: scores[0] += 0.011622; scores[1] += -0.043285; scores[2] += 0.031663; break;
      case 2: scores[0] += -0.018025; scores[1] += 0.008721; scores[2] += 0.009304; break;
      case 3: scores[0] += 0.014663; scores[1] += -0.000390; scores[2] += -0.014272; break;
      case 4: scores[0] += -0.016512; scores[1] += 0.005504; scores[2] += 0.011009; break;
      case 5: scores[0] += -0.018998; scores[1] += 0.020626; scores[2] += -0.001628; break;
      case 6: scores[0] += 0.007936; scores[1] += -0.019985; scores[2] += 0.012048; break;
      case 7: scores[0] += 0.006399; scores[1] += 0.006507; scores[2] += -0.012906; break;
      case 8: scores[0] += -0.032031; scores[1] += 0.012952; scores[2] += 0.019079; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002644; scores[1] += -0.008960; scores[2] += 0.011604; break;
      case 11: scores[0] += 0.025489; scores[1] += -0.005327; scores[2] += -0.020162; break;
      case 12: scores[0] += 0.006432; scores[1] += -0.003001; scores[2] += -0.003431; break;
      case 13: scores[0] += 0.000803; scores[1] += -0.001475; scores[2] += 0.000672; break;
      case 14: scores[0] += -0.003929; scores[1] += 0.020472; scores[2] += -0.016543; break;
      case 15: scores[0] += 0.012023; scores[1] += -0.001936; scores[2] += -0.010086; break;
    }
  }

  // Tree 228 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[10] > 7.7083330154418945) << 1) | ((features[11] > 0.2679487466812134) << 2) | ((features[9] > 1.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000813; scores[1] += -0.015746; scores[2] += 0.014933; break;
      case 1: scores[0] += 0.004215; scores[1] += -0.008411; scores[2] += 0.004196; break;
      case 2: scores[0] += 0.012890; scores[1] += 0.004114; scores[2] += -0.017004; break;
      case 3: scores[0] += -0.007002; scores[1] += 0.015244; scores[2] += -0.008242; break;
      case 4: scores[0] += 0.002657; scores[1] += -0.001707; scores[2] += -0.000951; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.008889; scores[1] += -0.004120; scores[2] += -0.004770; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.010422; scores[1] += 0.007505; scores[2] += 0.002918; break;
      case 9: scores[0] += -0.018604; scores[1] += 0.018833; scores[2] += -0.000228; break;
      case 10: scores[0] += -0.002204; scores[1] += 0.000480; scores[2] += 0.001724; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.008431; scores[1] += -0.025499; scores[2] += 0.033930; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003551; scores[1] += -0.005567; scores[2] += 0.009117; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 229 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[43] > 0.7663043737411499) << 1) | ((features[22] > 0.5) << 2) | ((features[13] > 0.8360214829444885) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002858; scores[1] += -0.001199; scores[2] += 0.004056; break;
      case 1: scores[0] += 0.031340; scores[1] += -0.016558; scores[2] += -0.014782; break;
      case 2: scores[0] += -0.000276; scores[1] += 0.003119; scores[2] += -0.002843; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.011549; scores[1] += 0.008219; scores[2] += 0.003331; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000260; scores[1] += 0.018162; scores[2] += -0.017902; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002305; scores[1] += 0.003754; scores[2] += -0.006059; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001538; scores[1] += -0.000725; scores[2] += 0.002263; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.029363; scores[1] += 0.007662; scores[2] += -0.037025; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 230 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8321678638458252) << 0) | ((features[10] > 4.900000095367432) << 1) | ((features[10] > 7.550000190734863) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004712; scores[1] += -0.019703; scores[2] += 0.014991; break;
      case 1: scores[0] += -0.031228; scores[1] += 0.019029; scores[2] += 0.012199; break;
      case 2: scores[0] += -0.021622; scores[1] += 0.010948; scores[2] += 0.010674; break;
      case 3: scores[0] += 0.024425; scores[1] += -0.019258; scores[2] += -0.005168; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.002577; scores[1] += -0.001624; scores[2] += -0.000953; break;
      case 7: scores[0] += -0.026241; scores[1] += 0.042320; scores[2] += -0.016079; break;
      case 8: scores[0] += -0.003501; scores[1] += 0.018793; scores[2] += -0.015292; break;
      case 9: scores[0] += -0.009411; scores[1] += 0.007875; scores[2] += 0.001537; break;
      case 10: scores[0] += 0.018373; scores[1] += -0.012243; scores[2] += -0.006129; break;
      case 11: scores[0] += -0.010706; scores[1] += -0.012858; scores[2] += 0.023564; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.005980; scores[1] += 0.013672; scores[2] += -0.007692; break;
      case 15: scores[0] += 0.012615; scores[1] += -0.014773; scores[2] += 0.002158; break;
    }
  }

  // Tree 231 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[10] > 4.7083330154418945) << 1) | ((features[33] > 0.5) << 2) | ((features[13] > 0.44636017084121704) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005391; scores[1] += 0.008068; scores[2] += -0.013458; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.003727; scores[1] += -0.001710; scores[2] += -0.002017; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000274; scores[1] += 0.001749; scores[2] += -0.001475; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.042802; scores[1] += 0.028460; scores[2] += 0.014343; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000392; scores[1] += 0.003051; scores[2] += -0.002659; break;
      case 9: scores[0] += -0.032108; scores[1] += 0.011105; scores[2] += 0.021003; break;
      case 10: scores[0] += -0.000816; scores[1] += -0.002184; scores[2] += 0.003000; break;
      case 11: scores[0] += 0.016731; scores[1] += -0.005749; scores[2] += -0.010983; break;
      case 12: scores[0] += -0.003506; scores[1] += -0.045523; scores[2] += 0.049029; break;
      case 13: scores[0] += -0.009193; scores[1] += 0.033215; scores[2] += -0.024022; break;
      case 14: scores[0] += 0.007582; scores[1] += 0.000706; scores[2] += -0.008288; break;
      case 15: scores[0] += -0.010577; scores[1] += -0.012095; scores[2] += 0.022672; break;
    }
  }

  // Tree 232 (depth=4)
  {
    const leafIdx = ((features[44] > 0.550000011920929) << 0) | ((features[13] > 0.42206478118896484) << 1) | ((features[13] > 0.4258241653442383) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006711; scores[1] += 0.008451; scores[2] += -0.001740; break;
      case 1: scores[0] += -0.000220; scores[1] += 0.001064; scores[2] += -0.000844; break;
      case 2: scores[0] += -0.001559; scores[1] += -0.040078; scores[2] += 0.041637; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003028; scores[1] += -0.003243; scores[2] += 0.006271; break;
      case 7: scores[0] += -0.002271; scores[1] += 0.020860; scores[2] += -0.018590; break;
      case 8: scores[0] += 0.005793; scores[1] += -0.012136; scores[2] += 0.006343; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.030527; scores[1] += -0.004451; scores[2] += -0.026075; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 233 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.4721362292766571) << 1) | ((features[13] > 0.521164059638977) << 2) | ((features[13] > 0.5797962546348572) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003643; scores[1] += 0.002439; scores[2] += 0.001203; break;
      case 1: scores[0] += 0.024077; scores[1] += -0.012214; scores[2] += -0.011863; break;
      case 2: scores[0] += -0.008088; scores[1] += -0.024807; scores[2] += 0.032895; break;
      case 3: scores[0] += 0.003113; scores[1] += -0.001333; scores[2] += -0.001781; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.014642; scores[1] += 0.011593; scores[2] += -0.026235; break;
      case 7: scores[0] += 0.010448; scores[1] += -0.006547; scores[2] += -0.003901; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000761; scores[1] += 0.000920; scores[2] += -0.000158; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 234 (depth=4)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[11] > 0.1889880895614624) << 1) | ((features[44] > 0.25) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002324; scores[1] += -0.002238; scores[2] += -0.000086; break;
      case 1: scores[0] += -0.006188; scores[1] += -0.027527; scores[2] += 0.033715; break;
      case 2: scores[0] += 0.000963; scores[1] += -0.000285; scores[2] += -0.000678; break;
      case 3: scores[0] += 0.023391; scores[1] += 0.005341; scores[2] += -0.028731; break;
      case 4: scores[0] += -0.010296; scores[1] += 0.005473; scores[2] += 0.004823; break;
      case 5: scores[0] += 0.015984; scores[1] += -0.023082; scores[2] += 0.007098; break;
      case 6: scores[0] += -0.003389; scores[1] += 0.034997; scores[2] += -0.031608; break;
      case 7: scores[0] += -0.014020; scores[1] += 0.003328; scores[2] += 0.010692; break;
      case 8: scores[0] += 0.024323; scores[1] += -0.001107; scores[2] += -0.023216; break;
      case 9: scores[0] += 0.001062; scores[1] += -0.005495; scores[2] += 0.004433; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.006975; scores[1] += -0.012107; scores[2] += 0.005133; break;
      case 12: scores[0] += 0.016801; scores[1] += -0.000096; scores[2] += -0.016705; break;
      case 13: scores[0] += -0.018453; scores[1] += 0.016596; scores[2] += 0.001857; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.002110; scores[1] += -0.000710; scores[2] += 0.002820; break;
    }
  }

  // Tree 235 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[11] > 0.14760348200798035) << 2) | ((features[43] > 0.1889880895614624) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000201; scores[1] += -0.000695; scores[2] += 0.000494; break;
      case 1: scores[0] += 0.005391; scores[1] += -0.003313; scores[2] += -0.002078; break;
      case 2: scores[0] += -0.002470; scores[1] += 0.015475; scores[2] += -0.013004; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.016875; scores[1] += 0.005289; scores[2] += -0.022163; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.014594; scores[1] += -0.052362; scores[2] += 0.037768; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.008904; scores[1] += 0.003217; scores[2] += 0.005687; break;
      case 9: scores[0] += -0.006332; scores[1] += -0.026111; scores[2] += 0.032443; break;
      case 10: scores[0] += 0.011774; scores[1] += -0.023876; scores[2] += 0.012102; break;
      case 11: scores[0] += -0.004522; scores[1] += 0.016073; scores[2] += -0.011551; break;
      case 12: scores[0] += 0.001408; scores[1] += 0.012848; scores[2] += -0.014256; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000755; scores[1] += 0.004772; scores[2] += -0.004017; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 236 (depth=4)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[40] > 0.5) << 1) | ((features[43] > 0.38083165884017944) << 2) | ((features[13] > 0.9183333516120911) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004533; scores[1] += -0.007125; scores[2] += 0.002592; break;
      case 1: scores[0] += -0.010884; scores[1] += 0.042924; scores[2] += -0.032040; break;
      case 2: scores[0] += 0.001785; scores[1] += 0.002060; scores[2] += -0.003845; break;
      case 3: scores[0] += -0.010834; scores[1] += -0.010335; scores[2] += 0.021169; break;
      case 4: scores[0] += -0.006472; scores[1] += 0.013555; scores[2] += -0.007083; break;
      case 5: scores[0] += -0.004303; scores[1] += 0.000181; scores[2] += 0.004122; break;
      case 6: scores[0] += -0.001038; scores[1] += 0.026973; scores[2] += -0.025935; break;
      case 7: scores[0] += -0.000990; scores[1] += -0.019527; scores[2] += 0.020517; break;
      case 8: scores[0] += 0.005378; scores[1] += 0.009091; scores[2] += -0.014469; break;
      case 9: scores[0] += 0.025641; scores[1] += -0.028933; scores[2] += 0.003292; break;
      case 10: scores[0] += -0.003479; scores[1] += -0.002553; scores[2] += 0.006032; break;
      case 11: scores[0] += -0.029151; scores[1] += 0.022860; scores[2] += 0.006291; break;
      case 12: scores[0] += 0.002549; scores[1] += -0.000477; scores[2] += -0.002072; break;
      case 13: scores[0] += -0.017123; scores[1] += 0.014944; scores[2] += 0.002180; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.001499; scores[1] += -0.013483; scores[2] += 0.014982; break;
    }
  }

  // Tree 237 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[13] > 0.48644688725471497) << 1) | ((features[14] > 0.5) << 2) | ((features[10] > 12.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003067; scores[1] += 0.001784; scores[2] += 0.001284; break;
      case 1: scores[0] += 0.011157; scores[1] += -0.044593; scores[2] += 0.033437; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.025662; scores[1] += -0.003757; scores[2] += -0.021905; break;
      case 4: scores[0] += -0.009689; scores[1] += 0.015549; scores[2] += -0.005860; break;
      case 5: scores[0] += 0.004279; scores[1] += -0.006930; scores[2] += 0.002651; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.000443; scores[1] += -0.000659; scores[2] += 0.001102; break;
      case 8: scores[0] += 0.008322; scores[1] += -0.015777; scores[2] += 0.007455; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.037986; scores[1] += 0.038706; scores[2] += -0.000720; break;
      case 12: scores[0] += -0.007102; scores[1] += 0.006628; scores[2] += 0.000473; break;
      case 13: scores[0] += 0.013908; scores[1] += -0.005145; scores[2] += -0.008763; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.010103; scores[1] += -0.014813; scores[2] += 0.004710; break;
    }
  }

  // Tree 238 (depth=4)
  {
    const leafIdx = ((features[10] > 9.583333969116211) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 10.416666030883789) << 2) | ((features[43] > 0.8321678638458252) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001512; scores[1] += 0.001561; scores[2] += -0.000048; break;
      case 1: scores[0] += 0.003430; scores[1] += -0.020500; scores[2] += 0.017070; break;
      case 2: scores[0] += 0.026028; scores[1] += -0.012526; scores[2] += -0.013502; break;
      case 3: scores[0] += -0.006748; scores[1] += -0.013825; scores[2] += 0.020573; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000145; scores[1] += 0.003987; scores[2] += -0.004133; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.028218; scores[1] += 0.044501; scores[2] += -0.016282; break;
      case 8: scores[0] += -0.003996; scores[1] += 0.003515; scores[2] += 0.000481; break;
      case 9: scores[0] += 0.039037; scores[1] += -0.024301; scores[2] += -0.014736; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.021544; scores[1] += 0.002349; scores[2] += 0.019195; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 239 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[27] > 0.5) << 1) | ((features[10] > 6.633333206176758) << 2) | ((features[13] > 0.9298029541969299) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.012819; scores[1] += -0.006143; scores[2] += -0.006675; break;
      case 1: scores[0] += 0.016094; scores[1] += -0.010531; scores[2] += -0.005563; break;
      case 2: scores[0] += -0.001215; scores[1] += -0.012634; scores[2] += 0.013850; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.006797; scores[1] += 0.004113; scores[2] += 0.002684; break;
      case 5: scores[0] += 0.019867; scores[1] += -0.008429; scores[2] += -0.011438; break;
      case 6: scores[0] += -0.000196; scores[1] += -0.007079; scores[2] += 0.007275; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.003951; scores[1] += 0.010187; scores[2] += -0.006237; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.007584; scores[1] += 0.010576; scores[2] += -0.018160; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.002751; scores[1] += -0.004946; scores[2] += 0.002195; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.010391; scores[1] += -0.017529; scores[2] += 0.027920; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 240 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[10] > 5.7083330154418945) << 2) | ((features[43] > 0.6651785373687744) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.016540; scores[1] += 0.002047; scores[2] += -0.018587; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.002544; scores[1] += -0.005876; scores[2] += 0.008420; break;
      case 3: scores[0] += -0.000030; scores[1] += -0.002083; scores[2] += 0.002114; break;
      case 4: scores[0] += 0.001207; scores[1] += -0.003021; scores[2] += 0.001815; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.002701; scores[1] += 0.003194; scores[2] += -0.000494; break;
      case 7: scores[0] += 0.003753; scores[1] += -0.018206; scores[2] += 0.014453; break;
      case 8: scores[0] += 0.005662; scores[1] += -0.000940; scores[2] += -0.004723; break;
      case 9: scores[0] += 0.001756; scores[1] += 0.004287; scores[2] += -0.006043; break;
      case 10: scores[0] += -0.014309; scores[1] += 0.009101; scores[2] += 0.005208; break;
      case 11: scores[0] += -0.004333; scores[1] += 0.014340; scores[2] += -0.010007; break;
      case 12: scores[0] += -0.005625; scores[1] += -0.020291; scores[2] += 0.025915; break;
      case 13: scores[0] += 0.010896; scores[1] += -0.006944; scores[2] += -0.003952; break;
      case 14: scores[0] += 0.004926; scores[1] += 0.012014; scores[2] += -0.016940; break;
      case 15: scores[0] += -0.015425; scores[1] += -0.014705; scores[2] += 0.030130; break;
    }
  }

  // Tree 241 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[9] > 1.5) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009797; scores[1] += -0.000481; scores[2] += -0.009316; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.003133; scores[1] += -0.020969; scores[2] += 0.017836; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.008768; scores[1] += 0.008403; scores[2] += 0.000366; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.015258; scores[1] += -0.000542; scores[2] += 0.015800; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.001467; scores[1] += 0.007539; scores[2] += -0.006073; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002172; scores[1] += 0.002971; scores[2] += -0.000800; break;
      case 13: scores[0] += 0.000117; scores[1] += -0.025386; scores[2] += 0.025269; break;
      case 14: scores[0] += -0.010210; scores[1] += 0.006835; scores[2] += 0.003375; break;
      case 15: scores[0] += -0.006677; scores[1] += 0.031869; scores[2] += -0.025192; break;
    }
  }

  // Tree 242 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[10] > 5.775000095367432) << 2) | ((features[43] > 0.22653958201408386) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002859; scores[1] += 0.009379; scores[2] += -0.012239; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.019028; scores[1] += -0.046416; scores[2] += 0.027388; break;
      case 3: scores[0] += -0.001907; scores[1] += -0.007702; scores[2] += 0.009608; break;
      case 4: scores[0] += 0.002335; scores[1] += 0.000556; scores[2] += -0.002892; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.010916; scores[1] += -0.009449; scores[2] += 0.020364; break;
      case 7: scores[0] += -0.007014; scores[1] += 0.025707; scores[2] += -0.018694; break;
      case 8: scores[0] += -0.002753; scores[1] += -0.001917; scores[2] += 0.004670; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001019; scores[1] += 0.016111; scores[2] += -0.015092; break;
      case 11: scores[0] += -0.000213; scores[1] += 0.001804; scores[2] += -0.001590; break;
      case 12: scores[0] += -0.008153; scores[1] += -0.003096; scores[2] += 0.011249; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000104; scores[1] += 0.003269; scores[2] += -0.003165; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 243 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[35] > 0.5) << 1) | ((features[9] > 2.5) << 2) | ((features[10] > 9.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001338; scores[1] += 0.007224; scores[2] += -0.005886; break;
      case 1: scores[0] += -0.001646; scores[1] += 0.007824; scores[2] += -0.006177; break;
      case 2: scores[0] += -0.017721; scores[1] += -0.031270; scores[2] += 0.048991; break;
      case 3: scores[0] += 0.016088; scores[1] += 0.037095; scores[2] += -0.053183; break;
      case 4: scores[0] += 0.008066; scores[1] += -0.002438; scores[2] += -0.005629; break;
      case 5: scores[0] += -0.002275; scores[1] += -0.000794; scores[2] += 0.003069; break;
      case 6: scores[0] += -0.006013; scores[1] += 0.002698; scores[2] += 0.003315; break;
      case 7: scores[0] += -0.005264; scores[1] += 0.013502; scores[2] += -0.008237; break;
      case 8: scores[0] += 0.005403; scores[1] += -0.011471; scores[2] += 0.006069; break;
      case 9: scores[0] += -0.006116; scores[1] += 0.015143; scores[2] += -0.009027; break;
      case 10: scores[0] += -0.004670; scores[1] += 0.038474; scores[2] += -0.033803; break;
      case 11: scores[0] += -0.002642; scores[1] += -0.020577; scores[2] += 0.023219; break;
      case 12: scores[0] += -0.018023; scores[1] += 0.014179; scores[2] += 0.003843; break;
      case 13: scores[0] += 0.010617; scores[1] += -0.025414; scores[2] += 0.014797; break;
      case 14: scores[0] += -0.005522; scores[1] += -0.003360; scores[2] += 0.008882; break;
      case 15: scores[0] += -0.004490; scores[1] += 0.027426; scores[2] += -0.022935; break;
    }
  }

  // Tree 244 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[4] > 0.5) << 2) | ((features[11] > 0.2679487466812134) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002958; scores[1] += 0.004332; scores[2] += -0.001374; break;
      case 1: scores[0] += 0.000397; scores[1] += -0.023431; scores[2] += 0.023034; break;
      case 2: scores[0] += -0.018100; scores[1] += 0.006839; scores[2] += 0.011261; break;
      case 3: scores[0] += -0.006485; scores[1] += 0.030838; scores[2] += -0.024353; break;
      case 4: scores[0] += 0.007227; scores[1] += 0.001659; scores[2] += -0.008886; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.003387; scores[1] += -0.020563; scores[2] += 0.017176; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.010366; scores[1] += -0.025417; scores[2] += 0.035783; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.010274; scores[1] += -0.005276; scores[2] += -0.004999; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 245 (depth=4)
  {
    const leafIdx = ((features[11] > 0.2679487466812134) << 0) | ((features[44] > 0.25) << 1) | ((features[11] > 0.1889880895614624) << 2) | ((features[19] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002070; scores[1] += -0.000738; scores[2] += 0.002808; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.005301; scores[1] += 0.001627; scores[2] += 0.003675; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.027385; scores[1] += -0.004284; scores[2] += -0.023101; break;
      case 5: scores[0] += -0.003220; scores[1] += -0.010010; scores[2] += 0.013230; break;
      case 6: scores[0] += -0.006560; scores[1] += 0.038829; scores[2] += -0.032269; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.018866; scores[1] += -0.030639; scores[2] += 0.011773; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.005665; scores[1] += 0.003684; scores[2] += -0.009349; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000431; scores[1] += 0.012163; scores[2] += -0.011732; break;
      case 13: scores[0] += 0.008067; scores[1] += -0.004448; scores[2] += -0.003619; break;
      case 14: scores[0] += -0.009245; scores[1] += 0.018734; scores[2] += -0.009490; break;
      case 15: scores[0] += -0.005661; scores[1] += -0.020778; scores[2] += 0.026439; break;
    }
  }

  // Tree 246 (depth=4)
  {
    const leafIdx = ((features[10] > 10.833333969116211) << 0) | ((features[11] > 0.06155303120613098) << 1) | ((features[31] > 0.5) << 2) | ((features[2] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002864; scores[1] += -0.002503; scores[2] += -0.000361; break;
      case 1: scores[0] += -0.011305; scores[1] += 0.011458; scores[2] += -0.000154; break;
      case 2: scores[0] += -0.015836; scores[1] += 0.010996; scores[2] += 0.004840; break;
      case 3: scores[0] += 0.021004; scores[1] += -0.007422; scores[2] += -0.013582; break;
      case 4: scores[0] += -0.011952; scores[1] += 0.006403; scores[2] += 0.005549; break;
      case 5: scores[0] += -0.020768; scores[1] += 0.035030; scores[2] += -0.014263; break;
      case 6: scores[0] += 0.031438; scores[1] += -0.004012; scores[2] += -0.027426; break;
      case 7: scores[0] += 0.029532; scores[1] += -0.015437; scores[2] += -0.014095; break;
      case 8: scores[0] += -0.002008; scores[1] += 0.023138; scores[2] += -0.021130; break;
      case 9: scores[0] += 0.005121; scores[1] += -0.014858; scores[2] += 0.009736; break;
      case 10: scores[0] += 0.011869; scores[1] += -0.021223; scores[2] += 0.009354; break;
      case 11: scores[0] += 0.012748; scores[1] += -0.011268; scores[2] += -0.001479; break;
      case 12: scores[0] += -0.004182; scores[1] += 0.004848; scores[2] += -0.000667; break;
      case 13: scores[0] += 0.011835; scores[1] += -0.011090; scores[2] += -0.000746; break;
      case 14: scores[0] += 0.003699; scores[1] += -0.016334; scores[2] += 0.012635; break;
      case 15: scores[0] += -0.037313; scores[1] += 0.021665; scores[2] += 0.015649; break;
    }
  }

  // Tree 247 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8918128609657288) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[10] > 9.875) << 2) | ((features[10] > 10.125) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001925; scores[1] += -0.001257; scores[2] += -0.000668; break;
      case 1: scores[0] += 0.005516; scores[1] += 0.006700; scores[2] += -0.012216; break;
      case 2: scores[0] += -0.003189; scores[1] += -0.010174; scores[2] += 0.013364; break;
      case 3: scores[0] += -0.002551; scores[1] += 0.004448; scores[2] += -0.001898; break;
      case 4: scores[0] += 0.002216; scores[1] += -0.013012; scores[2] += 0.010796; break;
      case 5: scores[0] += 0.002204; scores[1] += -0.027375; scores[2] += 0.025171; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.037157; scores[1] += -0.022790; scores[2] += -0.014367; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.003333; scores[1] += 0.004717; scores[2] += -0.001383; break;
      case 13: scores[0] += -0.001644; scores[1] += 0.006454; scores[2] += -0.004810; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.020947; scores[1] += 0.001752; scores[2] += 0.019196; break;
    }
  }

  // Tree 248 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 6.550000190734863) << 1) | ((features[43] > 0.7663043737411499) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001987; scores[1] += 0.005293; scores[2] += -0.007280; break;
      case 1: scores[0] += -0.000068; scores[1] += -0.001333; scores[2] += 0.001401; break;
      case 2: scores[0] += 0.000877; scores[1] += -0.002296; scores[2] += 0.001419; break;
      case 3: scores[0] += -0.000189; scores[1] += -0.006775; scores[2] += 0.006963; break;
      case 4: scores[0] += -0.000365; scores[1] += -0.008164; scores[2] += 0.008529; break;
      case 5: scores[0] += 0.009868; scores[1] += -0.000824; scores[2] += -0.009045; break;
      case 6: scores[0] += 0.009689; scores[1] += 0.017762; scores[2] += -0.027451; break;
      case 7: scores[0] += -0.015094; scores[1] += -0.014717; scores[2] += 0.029811; break;
      case 8: scores[0] += 0.006743; scores[1] += -0.011039; scores[2] += 0.004295; break;
      case 9: scores[0] += -0.001108; scores[1] += -0.011820; scores[2] += 0.012928; break;
      case 10: scores[0] += -0.003707; scores[1] += 0.006657; scores[2] += -0.002950; break;
      case 11: scores[0] += 0.005007; scores[1] += -0.003014; scores[2] += -0.001993; break;
      case 12: scores[0] += -0.014247; scores[1] += 0.008800; scores[2] += 0.005447; break;
      case 13: scores[0] += -0.004232; scores[1] += 0.014002; scores[2] += -0.009770; break;
      case 14: scores[0] += -0.001768; scores[1] += -0.016133; scores[2] += 0.017901; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 249 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[10] > 6.449999809265137) << 1) | ((features[10] > 7.550000190734863) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007667; scores[1] += 0.000647; scores[2] += -0.008315; break;
      case 1: scores[0] += -0.002857; scores[1] += 0.014123; scores[2] += -0.011267; break;
      case 2: scores[0] += -0.010873; scores[1] += -0.011110; scores[2] += 0.021984; break;
      case 3: scores[0] += -0.000866; scores[1] += 0.010593; scores[2] += -0.009727; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.001483; scores[1] += 0.002908; scores[2] += -0.004390; break;
      case 7: scores[0] += -0.001732; scores[1] += 0.019999; scores[2] += -0.018267; break;
      case 8: scores[0] += -0.007419; scores[1] += -0.004351; scores[2] += 0.011770; break;
      case 9: scores[0] += -0.001267; scores[1] += 0.014429; scores[2] += -0.013163; break;
      case 10: scores[0] += -0.006796; scores[1] += 0.008897; scores[2] += -0.002101; break;
      case 11: scores[0] += -0.003608; scores[1] += 0.031532; scores[2] += -0.027924; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000322; scores[1] += -0.014597; scores[2] += 0.014275; break;
      case 15: scores[0] += -0.008774; scores[1] += 0.034381; scores[2] += -0.025608; break;
    }
  }

  // Tree 250 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[44] > 0.44999998807907104) << 1) | ((features[10] > 6.2916669845581055) << 2) | ((features[13] > 0.22474747896194458) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.026201; scores[1] += -0.011611; scores[2] += -0.014590; break;
      case 1: scores[0] += -0.002324; scores[1] += -0.036961; scores[2] += 0.039285; break;
      case 2: scores[0] += -0.001585; scores[1] += 0.009087; scores[2] += -0.007502; break;
      case 3: scores[0] += -0.004616; scores[1] += -0.005659; scores[2] += 0.010275; break;
      case 4: scores[0] += -0.004728; scores[1] += 0.004979; scores[2] += -0.000251; break;
      case 5: scores[0] += -0.013141; scores[1] += -0.013374; scores[2] += 0.026514; break;
      case 6: scores[0] += -0.000401; scores[1] += 0.004546; scores[2] += -0.004145; break;
      case 7: scores[0] += -0.003423; scores[1] += 0.027549; scores[2] += -0.024125; break;
      case 8: scores[0] += -0.004514; scores[1] += 0.001011; scores[2] += 0.003503; break;
      case 9: scores[0] += 0.035018; scores[1] += 0.006059; scores[2] += -0.041077; break;
      case 10: scores[0] += -0.003795; scores[1] += 0.016679; scores[2] += -0.012884; break;
      case 11: scores[0] += -0.001786; scores[1] += 0.006864; scores[2] += -0.005078; break;
      case 12: scores[0] += 0.001977; scores[1] += -0.003166; scores[2] += 0.001190; break;
      case 13: scores[0] += -0.015591; scores[1] += 0.000029; scores[2] += 0.015561; break;
      case 14: scores[0] += -0.011966; scores[1] += 0.019682; scores[2] += -0.007716; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 251 (depth=4)
  {
    const leafIdx = ((features[13] > 0.3973684310913086) << 0) | ((features[13] > 0.4027026891708374) << 1) | ((features[10] > 9.291666030883789) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002202; scores[1] += 0.006957; scores[2] += -0.009159; break;
      case 1: scores[0] += -0.000440; scores[1] += -0.030585; scores[2] += 0.031025; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.007386; scores[1] += -0.007045; scores[2] += 0.014432; break;
      case 4: scores[0] += 0.002984; scores[1] += -0.006976; scores[2] += 0.003992; break;
      case 5: scores[0] += -0.007043; scores[1] += 0.013058; scores[2] += -0.006015; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.003251; scores[1] += 0.007622; scores[2] += -0.010874; break;
      case 8: scores[0] += -0.016278; scores[1] += 0.004615; scores[2] += 0.011662; break;
      case 9: scores[0] += -0.000066; scores[1] += 0.000775; scores[2] += -0.000710; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.002549; scores[1] += 0.005816; scores[2] += -0.003267; break;
      case 12: scores[0] += -0.001881; scores[1] += 0.010068; scores[2] += -0.008187; break;
      case 13: scores[0] += -0.000083; scores[1] += 0.000689; scores[2] += -0.000606; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.033256; scores[1] += -0.015819; scores[2] += -0.017437; break;
    }
  }

  // Tree 252 (depth=4)
  {
    const leafIdx = ((features[14] > 0.5) << 0) | ((features[31] > 0.5) << 1) | ((features[10] > 9.583333969116211) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005214; scores[1] += -0.012938; scores[2] += 0.007724; break;
      case 1: scores[0] += -0.002861; scores[1] += 0.015198; scores[2] += -0.012337; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.004405; scores[1] += -0.000479; scores[2] += 0.004883; break;
      case 4: scores[0] += -0.005845; scores[1] += 0.005876; scores[2] += -0.000032; break;
      case 5: scores[0] += 0.026653; scores[1] += -0.013542; scores[2] += -0.013112; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.012311; scores[1] += -0.038893; scores[2] += 0.026582; break;
      case 8: scores[0] += -0.007113; scores[1] += 0.006224; scores[2] += 0.000889; break;
      case 9: scores[0] += -0.000055; scores[1] += -0.004353; scores[2] += 0.004408; break;
      case 10: scores[0] += 0.040336; scores[1] += -0.028372; scores[2] += -0.011965; break;
      case 11: scores[0] += 0.002269; scores[1] += 0.009774; scores[2] += -0.012043; break;
      case 12: scores[0] += -0.027569; scores[1] += 0.007509; scores[2] += 0.020061; break;
      case 13: scores[0] += 0.018146; scores[1] += -0.014137; scores[2] += -0.004010; break;
      case 14: scores[0] += -0.020960; scores[1] += 0.012942; scores[2] += 0.008019; break;
      case 15: scores[0] += -0.015682; scores[1] += 0.022003; scores[2] += -0.006320; break;
    }
  }

  // Tree 253 (depth=4)
  {
    const leafIdx = ((features[43] > 0.9285714626312256) << 0) | ((features[10] > 4.7083330154418945) << 1) | ((features[33] > 0.5) << 2) | ((features[43] > 0.39642858505249023) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004982; scores[1] += 0.006657; scores[2] += -0.011638; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000888; scores[1] += -0.001257; scores[2] += 0.000369; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001137; scores[1] += -0.034857; scores[2] += 0.035994; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000793; scores[1] += 0.005429; scores[2] += -0.004636; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000601; scores[1] += 0.003713; scores[2] += -0.003112; break;
      case 9: scores[0] += -0.030453; scores[1] += 0.009268; scores[2] += 0.021184; break;
      case 10: scores[0] += -0.006453; scores[1] += 0.021810; scores[2] += -0.015356; break;
      case 11: scores[0] += 0.015700; scores[1] += -0.005767; scores[2] += -0.009933; break;
      case 12: scores[0] += -0.003329; scores[1] += -0.007671; scores[2] += 0.011000; break;
      case 13: scores[0] += -0.007519; scores[1] += 0.027574; scores[2] += -0.020054; break;
      case 14: scores[0] += -0.003320; scores[1] += -0.017784; scores[2] += 0.021104; break;
      case 15: scores[0] += -0.009380; scores[1] += -0.012281; scores[2] += 0.021661; break;
    }
  }

  // Tree 254 (depth=4)
  {
    const leafIdx = ((features[10] > 6.633333206176758) << 0) | ((features[27] > 0.5) << 1) | ((features[44] > 0.550000011920929) << 2) | ((features[13] > 0.9354166984558105) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.016103; scores[1] += -0.008013; scores[2] += -0.008091; break;
      case 1: scores[0] += -0.002744; scores[1] += 0.001874; scores[2] += 0.000871; break;
      case 2: scores[0] += -0.001162; scores[1] += -0.012029; scores[2] += 0.013191; break;
      case 3: scores[0] += -0.000180; scores[1] += -0.006482; scores[2] += 0.006661; break;
      case 4: scores[0] += -0.000198; scores[1] += 0.000961; scores[2] += -0.000763; break;
      case 5: scores[0] += -0.000246; scores[1] += 0.016720; scores[2] += -0.016474; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.003757; scores[1] += 0.008668; scores[2] += -0.004911; break;
      case 9: scores[0] += -0.000344; scores[1] += -0.005375; scores[2] += 0.005719; break;
      case 10: scores[0] += 0.007084; scores[1] += 0.009560; scores[2] += -0.016644; break;
      case 11: scores[0] += -0.009837; scores[1] += -0.016849; scores[2] += 0.026686; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.002453; scores[1] += 0.004313; scores[2] += -0.001860; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 255 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[13] > 0.42206478118896484) << 1) | ((features[10] > 4.7083330154418945) << 2) | ((features[13] > 0.4202037453651428) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004639; scores[1] += 0.005343; scores[2] += -0.009982; break;
      case 1: scores[0] += -0.000347; scores[1] += 0.003945; scores[2] += -0.003597; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.003470; scores[1] += 0.003079; scores[2] += 0.000392; break;
      case 5: scores[0] += -0.003058; scores[1] += 0.017077; scores[2] += -0.014019; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000999; scores[1] += -0.035791; scores[2] += 0.036790; break;
      case 11: scores[0] += -0.028533; scores[1] += 0.016732; scores[2] += 0.011801; break;
      case 12: scores[0] += -0.001546; scores[1] += 0.018012; scores[2] += -0.016467; break;
      case 13: scores[0] += -0.000036; scores[1] += 0.026240; scores[2] += -0.026204; break;
      case 14: scores[0] += 0.001574; scores[1] += -0.004093; scores[2] += 0.002519; break;
      case 15: scores[0] += 0.008735; scores[1] += -0.007941; scores[2] += -0.000794; break;
    }
  }

  // Tree 256 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[10] > 5.449999809265137) << 2) | ((features[13] > 0.8495475053787231) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.011758; scores[1] += -0.003974; scores[2] += -0.007784; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.001884; scores[1] += -0.019785; scores[2] += 0.021669; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.004703; scores[1] += 0.001839; scores[2] += 0.002864; break;
      case 5: scores[0] += 0.029731; scores[1] += -0.015350; scores[2] += -0.014381; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.001734; scores[1] += 0.012388; scores[2] += -0.010654; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.009720; scores[1] += 0.011162; scores[2] += -0.020882; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.002878; scores[1] += 0.003724; scores[2] += -0.006602; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.009499; scores[1] += -0.010057; scores[2] += 0.019556; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 257 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[27] > 0.5) << 1) | ((features[10] > 6.366666793823242) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.010285; scores[1] += 0.010184; scores[2] += 0.000101; break;
      case 1: scores[0] += 0.000760; scores[1] += -0.004478; scores[2] += 0.003718; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.009096; scores[1] += -0.000552; scores[2] += -0.008544; break;
      case 4: scores[0] += 0.002701; scores[1] += -0.003825; scores[2] += 0.001124; break;
      case 5: scores[0] += 0.002092; scores[1] += 0.014144; scores[2] += -0.016236; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.014622; scores[1] += -0.013864; scores[2] += 0.028486; break;
      case 8: scores[0] += 0.019560; scores[1] += -0.010745; scores[2] += -0.008815; break;
      case 9: scores[0] += -0.007516; scores[1] += 0.024718; scores[2] += -0.017202; break;
      case 10: scores[0] += -0.001126; scores[1] += -0.011717; scores[2] += 0.012843; break;
      case 11: scores[0] += -0.004009; scores[1] += 0.010586; scores[2] += -0.006578; break;
      case 12: scores[0] += -0.005100; scores[1] += 0.003814; scores[2] += 0.001286; break;
      case 13: scores[0] += -0.003848; scores[1] += -0.015553; scores[2] += 0.019401; break;
      case 14: scores[0] += 0.004781; scores[1] += -0.008004; scores[2] += 0.003224; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 258 (depth=4)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[11] > 0.07549858093261719) << 2) | ((features[2] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000867; scores[1] += -0.000425; scores[2] += 0.001292; break;
      case 1: scores[0] += 0.018196; scores[1] += -0.014878; scores[2] += -0.003318; break;
      case 2: scores[0] += -0.009228; scores[1] += 0.011182; scores[2] += -0.001954; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.002018; scores[1] += 0.007633; scores[2] += -0.005615; break;
      case 5: scores[0] += 0.027996; scores[1] += 0.015330; scores[2] += -0.043326; break;
      case 6: scores[0] += 0.029108; scores[1] += -0.012783; scores[2] += -0.016325; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.013486; scores[1] += -0.030758; scores[2] += 0.017271; break;
      case 9: scores[0] += -0.004021; scores[1] += 0.004484; scores[2] += -0.000464; break;
      case 10: scores[0] += 0.018459; scores[1] += -0.015653; scores[2] += -0.002807; break;
      case 11: scores[0] += -0.005326; scores[1] += -0.008532; scores[2] += 0.013858; break;
      case 12: scores[0] += 0.009873; scores[1] += -0.008179; scores[2] += -0.001694; break;
      case 13: scores[0] += -0.021878; scores[1] += -0.007599; scores[2] += 0.029477; break;
      case 14: scores[0] += 0.002280; scores[1] += -0.029609; scores[2] += 0.027329; break;
      case 15: scores[0] += -0.021570; scores[1] += 0.046878; scores[2] += -0.025308; break;
    }
  }

  // Tree 259 (depth=4)
  {
    const leafIdx = ((features[8] > 0.5) << 0) | ((features[34] > 0.44999998807907104) << 1) | ((features[10] > 6.366666793823242) << 2) | ((features[13] > 0.5797962546348572) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.024039; scores[1] += -0.013448; scores[2] += -0.010591; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.006911; scores[1] += 0.000779; scores[2] += 0.006131; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.004150; scores[1] += 0.002050; scores[2] += 0.002099; break;
      case 5: scores[0] += 0.019549; scores[1] += -0.015518; scores[2] += -0.004030; break;
      case 6: scores[0] += -0.003564; scores[1] += 0.027141; scores[2] += -0.023578; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.001457; scores[1] += 0.006878; scores[2] += -0.008335; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001291; scores[1] += -0.002419; scores[2] += 0.003711; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 260 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[22] > 0.5) << 1) | ((features[13] > 0.7295321226119995) << 2) | ((features[10] > 9.125) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006953; scores[1] += 0.000345; scores[2] += -0.007298; break;
      case 1: scores[0] += -0.006466; scores[1] += -0.001925; scores[2] += 0.008391; break;
      case 2: scores[0] += -0.000074; scores[1] += 0.000230; scores[2] += -0.000156; break;
      case 3: scores[0] += -0.004862; scores[1] += 0.015696; scores[2] += -0.010834; break;
      case 4: scores[0] += -0.025607; scores[1] += 0.016383; scores[2] += 0.009224; break;
      case 5: scores[0] += 0.007358; scores[1] += -0.001396; scores[2] += -0.005962; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.014003; scores[1] += -0.022278; scores[2] += 0.036281; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.006962; scores[1] += -0.000212; scores[2] += -0.006750; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.012842; scores[1] += -0.001324; scores[2] += 0.014167; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.000579; scores[1] += -0.000625; scores[2] += 0.001204; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.026138; scores[1] += 0.013200; scores[2] += -0.039339; break;
    }
  }

  // Tree 261 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[14] > 0.5) << 1) | ((features[13] > 0.9354166984558105) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000037; scores[1] += -0.003165; scores[2] += 0.003128; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.003197; scores[1] += 0.003248; scores[2] += -0.000051; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.005637; scores[1] += 0.018311; scores[2] += -0.012674; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.002587; scores[1] += -0.005801; scores[2] += 0.003214; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.020805; scores[1] += -0.016076; scores[2] += -0.004728; break;
      case 9: scores[0] += -0.009543; scores[1] += 0.019463; scores[2] += -0.009920; break;
      case 10: scores[0] += -0.004533; scores[1] += 0.016996; scores[2] += -0.012463; break;
      case 11: scores[0] += -0.000341; scores[1] += 0.002850; scores[2] += -0.002508; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.003188; scores[1] += -0.007996; scores[2] += 0.004807; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 262 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[13] > 0.42206478118896484) << 2) | ((features[10] > 4.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005770; scores[1] += -0.001297; scores[2] += -0.004473; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.002341; scores[1] += 0.012783; scores[2] += -0.010443; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001366; scores[1] += -0.028538; scores[2] += 0.029904; break;
      case 5: scores[0] += -0.025382; scores[1] += 0.012098; scores[2] += 0.013284; break;
      case 6: scores[0] += -0.002297; scores[1] += -0.018356; scores[2] += 0.020653; break;
      case 7: scores[0] += -0.005408; scores[1] += 0.021457; scores[2] += -0.016049; break;
      case 8: scores[0] += -0.000370; scores[1] += 0.003486; scores[2] += -0.003116; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.017083; scores[1] += 0.006901; scores[2] += 0.010182; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001597; scores[1] += -0.005132; scores[2] += 0.006729; break;
      case 13: scores[0] += 0.014122; scores[1] += -0.000923; scores[2] += -0.013200; break;
      case 14: scores[0] += 0.014201; scores[1] += 0.000131; scores[2] += -0.014332; break;
      case 15: scores[0] += -0.002297; scores[1] += -0.014980; scores[2] += 0.017278; break;
    }
  }

  // Tree 263 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8321678638458252) << 0) | ((features[10] > 5.366666793823242) << 1) | ((features[9] > 1.5) << 2) | ((features[10] > 6.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.015174; scores[1] += -0.012876; scores[2] += -0.002298; break;
      case 1: scores[0] += 0.006918; scores[1] += -0.002663; scores[2] += -0.004256; break;
      case 2: scores[0] += -0.019696; scores[1] += 0.022835; scores[2] += -0.003139; break;
      case 3: scores[0] += -0.000072; scores[1] += -0.021998; scores[2] += 0.022071; break;
      case 4: scores[0] += -0.002189; scores[1] += 0.004291; scores[2] += -0.002101; break;
      case 5: scores[0] += -0.011676; scores[1] += 0.019437; scores[2] += -0.007762; break;
      case 6: scores[0] += -0.009129; scores[1] += 0.003180; scores[2] += 0.005950; break;
      case 7: scores[0] += -0.004731; scores[1] += -0.013617; scores[2] += 0.018348; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.009550; scores[1] += -0.002004; scores[2] += -0.007546; break;
      case 11: scores[0] += -0.003913; scores[1] += 0.008462; scores[2] += -0.004549; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003250; scores[1] += 0.002041; scores[2] += 0.001209; break;
      case 15: scores[0] += -0.001655; scores[1] += -0.015047; scores[2] += 0.016702; break;
    }
  }

  // Tree 264 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[40] > 0.5) << 2) | ((features[44] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006260; scores[1] += 0.003202; scores[2] += -0.009462; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.022075; scores[1] += -0.007906; scores[2] += 0.029981; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.017185; scores[1] += 0.000201; scores[2] += -0.017386; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.025366; scores[1] += -0.013810; scores[2] += -0.011556; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.007187; scores[1] += 0.003034; scores[2] += -0.010221; break;
      case 9: scores[0] += 0.011196; scores[1] += -0.027368; scores[2] += 0.016173; break;
      case 10: scores[0] += -0.019350; scores[1] += -0.005675; scores[2] += 0.025024; break;
      case 11: scores[0] += -0.002536; scores[1] += 0.013397; scores[2] += -0.010861; break;
      case 12: scores[0] += -0.012397; scores[1] += -0.000291; scores[2] += 0.012688; break;
      case 13: scores[0] += -0.016551; scores[1] += -0.007177; scores[2] += 0.023728; break;
      case 14: scores[0] += -0.003725; scores[1] += 0.015463; scores[2] += -0.011738; break;
      case 15: scores[0] += -0.004327; scores[1] += 0.024987; scores[2] += -0.020660; break;
    }
  }

  // Tree 265 (depth=4)
  {
    const leafIdx = ((features[11] > 0.2679487466812134) << 0) | ((features[9] > 1.5) << 1) | ((features[35] > 0.5) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005334; scores[1] += 0.000604; scores[2] += -0.005937; break;
      case 1: scores[0] += 0.009770; scores[1] += -0.004911; scores[2] += -0.004860; break;
      case 2: scores[0] += -0.002290; scores[1] += 0.003203; scores[2] += -0.000913; break;
      case 3: scores[0] += -0.009773; scores[1] += -0.023433; scores[2] += 0.033206; break;
      case 4: scores[0] += -0.010591; scores[1] += -0.012637; scores[2] += 0.023228; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.014535; scores[1] += 0.000277; scores[2] += 0.014257; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000099; scores[1] += -0.002063; scores[2] += 0.001965; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.016701; scores[1] += -0.009553; scores[2] += -0.007148; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.010995; scores[1] += 0.021379; scores[2] += -0.010384; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 266 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[43] > 0.6651785373687744) << 1) | ((features[13] > 0.8198052048683167) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000187; scores[1] += -0.005353; scores[2] += 0.005540; break;
      case 1: scores[0] += 0.005449; scores[1] += 0.009502; scores[2] += -0.014951; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000142; scores[1] += -0.004300; scores[2] += 0.004442; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.002160; scores[1] += -0.009455; scores[2] += 0.007294; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.001782; scores[1] += -0.001638; scores[2] += -0.000144; break;
      case 9: scores[0] += -0.017072; scores[1] += 0.005361; scores[2] += 0.011711; break;
      case 10: scores[0] += -0.000247; scores[1] += 0.003341; scores[2] += -0.003093; break;
      case 11: scores[0] += -0.001508; scores[1] += 0.011717; scores[2] += -0.010209; break;
      case 12: scores[0] += -0.001529; scores[1] += 0.009999; scores[2] += -0.008469; break;
      case 13: scores[0] += 0.025435; scores[1] += 0.012590; scores[2] += -0.038025; break;
      case 14: scores[0] += -0.011360; scores[1] += 0.005564; scores[2] += 0.005796; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 267 (depth=4)
  {
    const leafIdx = ((features[11] > 0.028991596773266792) << 0) | ((features[11] > 0.03637566417455673) << 1) | ((features[40] > 0.5) << 2) | ((features[10] > 7.550000190734863) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008432; scores[1] += -0.006489; scores[2] += -0.001942; break;
      case 1: scores[0] += -0.000015; scores[1] += 0.000547; scores[2] += -0.000532; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.016567; scores[1] += 0.013779; scores[2] += 0.002788; break;
      case 4: scores[0] += -0.028085; scores[1] += 0.004486; scores[2] += 0.023599; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.021959; scores[1] += 0.021331; scores[2] += 0.000628; break;
      case 8: scores[0] += -0.005344; scores[1] += 0.003324; scores[2] += 0.002020; break;
      case 9: scores[0] += -0.004751; scores[1] += 0.029965; scores[2] += -0.025214; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.013370; scores[1] += -0.009968; scores[2] += -0.003403; break;
      case 12: scores[0] += -0.000058; scores[1] += 0.016448; scores[2] += -0.016390; break;
      case 13: scores[0] += -0.008926; scores[1] += -0.023794; scores[2] += 0.032720; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.002004; scores[1] += -0.007035; scores[2] += 0.005031; break;
    }
  }

  // Tree 268 (depth=4)
  {
    const leafIdx = ((features[11] > 0.033908046782016754) << 0) | ((features[11] > 0.037749290466308594) << 1) | ((features[40] > 0.5) << 2) | ((features[10] > 6.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003752; scores[1] += -0.004573; scores[2] += 0.000821; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.004971; scores[1] += 0.013205; scores[2] += -0.008235; break;
      case 4: scores[0] += -0.018542; scores[1] += 0.001596; scores[2] += 0.016947; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.010524; scores[1] += 0.024376; scores[2] += -0.013852; break;
      case 8: scores[0] += -0.000870; scores[1] += 0.002015; scores[2] += -0.001145; break;
      case 9: scores[0] += -0.001214; scores[1] += 0.004405; scores[2] += -0.003190; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.009163; scores[1] += -0.009614; scores[2] += 0.000451; break;
      case 12: scores[0] += -0.008762; scores[1] += 0.008381; scores[2] += 0.000381; break;
      case 13: scores[0] += -0.005123; scores[1] += -0.018615; scores[2] += 0.023737; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.000913; scores[1] += -0.002754; scores[2] += 0.003667; break;
    }
  }

  // Tree 269 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 5.775000095367432) << 1) | ((features[10] > 5.633333206176758) << 2) | ((features[13] > 0.22474747896194458) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009016; scores[1] += 0.006088; scores[2] += -0.015103; break;
      case 1: scores[0] += -0.002453; scores[1] += -0.016729; scores[2] += 0.019182; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001701; scores[1] += -0.015258; scores[2] += 0.016959; break;
      case 5: scores[0] += -0.000690; scores[1] += -0.029760; scores[2] += 0.030450; break;
      case 6: scores[0] += -0.000361; scores[1] += 0.002765; scores[2] += -0.002404; break;
      case 7: scores[0] += -0.018858; scores[1] += 0.004939; scores[2] += 0.013919; break;
      case 8: scores[0] += -0.003379; scores[1] += 0.001688; scores[2] += 0.001692; break;
      case 9: scores[0] += 0.017225; scores[1] += 0.004874; scores[2] += -0.022099; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000097; scores[1] += -0.002703; scores[2] += 0.002800; break;
      case 13: scores[0] += -0.000031; scores[1] += 0.000560; scores[2] += -0.000528; break;
      case 14: scores[0] += 0.000312; scores[1] += -0.001234; scores[2] += 0.000922; break;
      case 15: scores[0] += -0.002214; scores[1] += 0.004555; scores[2] += -0.002341; break;
    }
  }

  // Tree 270 (depth=4)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[26] > 0.5) << 1) | ((features[10] > 8.708333969116211) << 2) | ((features[13] > 0.49418604373931885) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.011076; scores[1] += -0.008769; scores[2] += -0.002307; break;
      case 1: scores[0] += -0.000457; scores[1] += 0.001214; scores[2] += -0.000756; break;
      case 2: scores[0] += -0.005867; scores[1] += 0.017377; scores[2] += -0.011510; break;
      case 3: scores[0] += -0.001650; scores[1] += 0.011840; scores[2] += -0.010190; break;
      case 4: scores[0] += 0.008892; scores[1] += -0.008306; scores[2] += -0.000586; break;
      case 5: scores[0] += -0.006505; scores[1] += -0.004193; scores[2] += 0.010698; break;
      case 6: scores[0] += -0.009229; scores[1] += 0.016329; scores[2] += -0.007100; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.007869; scores[1] += -0.006241; scores[2] += 0.014110; break;
      case 9: scores[0] += 0.001360; scores[1] += -0.002357; scores[2] += 0.000997; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.000509; scores[1] += 0.003023; scores[2] += -0.002514; break;
      case 12: scores[0] += 0.002029; scores[1] += -0.004367; scores[2] += 0.002337; break;
      case 13: scores[0] += -0.003977; scores[1] += 0.018865; scores[2] += -0.014888; break;
      case 14: scores[0] += -0.001416; scores[1] += 0.004765; scores[2] += -0.003349; break;
      case 15: scores[0] += -0.000873; scores[1] += 0.002658; scores[2] += -0.001786; break;
    }
  }

  // Tree 271 (depth=4)
  {
    const leafIdx = ((features[23] > 0.5) << 0) | ((features[11] > 0.07059800624847412) << 1) | ((features[34] > 0.3500000238418579) << 2) | ((features[44] > 0.44999998807907104) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005127; scores[1] += -0.001479; scores[2] += 0.006606; break;
      case 1: scores[0] += -0.009537; scores[1] += 0.041690; scores[2] += -0.032152; break;
      case 2: scores[0] += 0.016054; scores[1] += -0.007770; scores[2] += -0.008284; break;
      case 3: scores[0] += -0.002796; scores[1] += 0.021956; scores[2] += -0.019160; break;
      case 4: scores[0] += 0.012463; scores[1] += -0.030523; scores[2] += 0.018060; break;
      case 5: scores[0] += -0.002093; scores[1] += 0.005373; scores[2] += -0.003280; break;
      case 6: scores[0] += -0.013946; scores[1] += 0.006014; scores[2] += 0.007932; break;
      case 7: scores[0] += -0.000677; scores[1] += 0.002879; scores[2] += -0.002201; break;
      case 8: scores[0] += -0.013461; scores[1] += 0.028132; scores[2] += -0.014671; break;
      case 9: scores[0] += -0.000834; scores[1] += 0.003777; scores[2] += -0.002943; break;
      case 10: scores[0] += -0.001208; scores[1] += 0.004099; scores[2] += -0.002891; break;
      case 11: scores[0] += -0.000124; scores[1] += 0.000342; scores[2] += -0.000218; break;
      case 12: scores[0] += -0.006246; scores[1] += 0.021461; scores[2] += -0.015215; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002897; scores[1] += -0.000101; scores[2] += 0.002998; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 272 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[44] > 0.550000011920929) << 1) | ((features[13] > 0.1449579894542694) << 2) | ((features[13] > 0.16904762387275696) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005056; scores[1] += 0.005362; scores[2] += -0.000307; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000198; scores[1] += 0.000921; scores[2] += -0.000723; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.001452; scores[1] += -0.026268; scores[2] += 0.024816; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000618; scores[1] += -0.000668; scores[2] += 0.001286; break;
      case 13: scores[0] += 0.028558; scores[1] += -0.014490; scores[2] += -0.014068; break;
      case 14: scores[0] += -0.002157; scores[1] += 0.019461; scores[2] += -0.017304; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 273 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[13] > 0.8245074152946472) << 1) | ((features[13] > 0.8198052048683167) << 2) | ((features[31] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005117; scores[1] += -0.000250; scores[2] += 0.005367; break;
      case 1: scores[0] += -0.005519; scores[1] += 0.004188; scores[2] += 0.001331; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.028125; scores[1] += 0.011546; scores[2] += -0.039671; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.004773; scores[1] += 0.008255; scores[2] += -0.013027; break;
      case 7: scores[0] += 0.014375; scores[1] += 0.009624; scores[2] += -0.023999; break;
      case 8: scores[0] += -0.003311; scores[1] += 0.008850; scores[2] += -0.005539; break;
      case 9: scores[0] += 0.006739; scores[1] += 0.006541; scores[2] += -0.013279; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.005608; scores[1] += -0.003516; scores[2] += 0.009124; break;
      case 15: scores[0] += 0.003624; scores[1] += -0.007782; scores[2] += 0.004158; break;
    }
  }

  // Tree 274 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[13] > 0.8164982795715332) << 1) | ((features[10] > 7.4166669845581055) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001031; scores[1] += -0.002302; scores[2] += 0.003333; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.026185; scores[1] += 0.049426; scores[2] += -0.023240; break;
      case 3: scores[0] += 0.004329; scores[1] += -0.004764; scores[2] += 0.000435; break;
      case 4: scores[0] += 0.001316; scores[1] += -0.002312; scores[2] += 0.000997; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.002609; scores[1] += -0.001829; scores[2] += -0.000781; break;
      case 7: scores[0] += -0.025058; scores[1] += 0.039114; scores[2] += -0.014056; break;
      case 8: scores[0] += -0.000540; scores[1] += 0.001735; scores[2] += -0.001195; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.033422; scores[1] += -0.030360; scores[2] += -0.003062; break;
      case 11: scores[0] += -0.013750; scores[1] += 0.003331; scores[2] += 0.010419; break;
      case 12: scores[0] += -0.020998; scores[1] += 0.015587; scores[2] += 0.005411; break;
      case 13: scores[0] += -0.000236; scores[1] += 0.016400; scores[2] += -0.016164; break;
      case 14: scores[0] += 0.007716; scores[1] += 0.004468; scores[2] += -0.012184; break;
      case 15: scores[0] += 0.003680; scores[1] += -0.018832; scores[2] += 0.015152; break;
    }
  }

  // Tree 275 (depth=4)
  {
    const leafIdx = ((features[13] > 0.46291208267211914) << 0) | ((features[0] > 0.5) << 1) | ((features[10] > 9.583333969116211) << 2) | ((features[43] > 0.20416666567325592) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005652; scores[1] += 0.013214; scores[2] += -0.007562; break;
      case 1: scores[0] += 0.001720; scores[1] += -0.012353; scores[2] += 0.010632; break;
      case 2: scores[0] += 0.009015; scores[1] += -0.019718; scores[2] += 0.010703; break;
      case 3: scores[0] += 0.034151; scores[1] += 0.006081; scores[2] += -0.040232; break;
      case 4: scores[0] += 0.004626; scores[1] += -0.008773; scores[2] += 0.004147; break;
      case 5: scores[0] += -0.001520; scores[1] += 0.005439; scores[2] += -0.003919; break;
      case 6: scores[0] += -0.003052; scores[1] += 0.003549; scores[2] += -0.000498; break;
      case 7: scores[0] += 0.007690; scores[1] += -0.008945; scores[2] += 0.001255; break;
      case 8: scores[0] += -0.015197; scores[1] += -0.013535; scores[2] += 0.028732; break;
      case 9: scores[0] += -0.004999; scores[1] += 0.007261; scores[2] += -0.002262; break;
      case 10: scores[0] += -0.003698; scores[1] += 0.008702; scores[2] += -0.005003; break;
      case 11: scores[0] += 0.012614; scores[1] += -0.002640; scores[2] += -0.009974; break;
      case 12: scores[0] += -0.006288; scores[1] += 0.012282; scores[2] += -0.005994; break;
      case 13: scores[0] += -0.002053; scores[1] += -0.010645; scores[2] += 0.012698; break;
      case 14: scores[0] += 0.003640; scores[1] += -0.002304; scores[2] += -0.001336; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 276 (depth=4)
  {
    const leafIdx = ((features[43] > 0.6651785373687744) << 0) | ((features[13] > 0.7467948794364929) << 1) | ((features[27] > 0.5) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000751; scores[1] += -0.000381; scores[2] += -0.000370; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000079; scores[1] += -0.004215; scores[2] += 0.004136; break;
      case 3: scores[0] += -0.000738; scores[1] += -0.009471; scores[2] += 0.010209; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.007672; scores[1] += 0.000512; scores[2] += -0.008184; break;
      case 8: scores[0] += -0.001825; scores[1] += 0.001499; scores[2] += 0.000325; break;
      case 9: scores[0] += -0.000963; scores[1] += 0.005837; scores[2] += -0.004873; break;
      case 10: scores[0] += -0.000207; scores[1] += 0.003377; scores[2] += -0.003169; break;
      case 11: scores[0] += -0.002296; scores[1] += 0.007320; scores[2] += -0.005024; break;
      case 12: scores[0] += -0.000097; scores[1] += -0.005565; scores[2] += 0.005662; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.003574; scores[1] += -0.015115; scores[2] += 0.011541; break;
      case 15: scores[0] += -0.017572; scores[1] += -0.000866; scores[2] += 0.018437; break;
    }
  }

  // Tree 277 (depth=4)
  {
    const leafIdx = ((features[10] > 8.291666030883789) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[13] > 0.9183333516120911) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005614; scores[1] += -0.035435; scores[2] += 0.041049; break;
      case 1: scores[0] += 0.016397; scores[1] += -0.004016; scores[2] += -0.012381; break;
      case 2: scores[0] += -0.012159; scores[1] += 0.007281; scores[2] += 0.004878; break;
      case 3: scores[0] += -0.003138; scores[1] += 0.005718; scores[2] += -0.002580; break;
      case 4: scores[0] += -0.026849; scores[1] += 0.030488; scores[2] += -0.003638; break;
      case 5: scores[0] += 0.007244; scores[1] += 0.007679; scores[2] += -0.014923; break;
      case 6: scores[0] += 0.010974; scores[1] += -0.011200; scores[2] += 0.000226; break;
      case 7: scores[0] += 0.002599; scores[1] += -0.003883; scores[2] += 0.001284; break;
      case 8: scores[0] += 0.022664; scores[1] += -0.014157; scores[2] += -0.008507; break;
      case 9: scores[0] += 0.015447; scores[1] += 0.003232; scores[2] += -0.018679; break;
      case 10: scores[0] += -0.040261; scores[1] += 0.019651; scores[2] += 0.020610; break;
      case 11: scores[0] += 0.006664; scores[1] += -0.004506; scores[2] += -0.002158; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.005997; scores[1] += -0.004928; scores[2] += -0.001069; break;
      case 14: scores[0] += -0.013961; scores[1] += 0.015011; scores[2] += -0.001050; break;
      case 15: scores[0] += -0.021175; scores[1] += 0.004832; scores[2] += 0.016344; break;
    }
  }

  // Tree 278 (depth=4)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[11] > 0.1889880895614624) << 1) | ((features[3] > 0.5) << 2) | ((features[11] > 0.13188406825065613) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000393; scores[1] += 0.000019; scores[2] += 0.000374; break;
      case 1: scores[0] += -0.004062; scores[1] += 0.002093; scores[2] += 0.001969; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.006637; scores[1] += 0.050658; scores[2] += -0.044021; break;
      case 5: scores[0] += -0.008586; scores[1] += 0.000788; scores[2] += 0.007797; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.029540; scores[1] += -0.052085; scores[2] += 0.022545; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.016047; scores[1] += 0.007924; scores[2] += -0.023971; break;
      case 11: scores[0] += -0.002820; scores[1] += 0.029175; scores[2] += -0.026354; break;
      case 12: scores[0] += -0.016200; scores[1] += 0.006997; scores[2] += 0.009203; break;
      case 13: scores[0] += 0.018380; scores[1] += -0.021809; scores[2] += 0.003429; break;
      case 14: scores[0] += -0.005061; scores[1] += -0.000473; scores[2] += 0.005534; break;
      case 15: scores[0] += -0.001513; scores[1] += -0.001674; scores[2] += 0.003187; break;
    }
  }

  // Tree 279 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9384469985961914) << 0) | ((features[13] > 0.9354166984558105) << 1) | ((features[11] > 0.06155303120613098) << 2) | ((features[11] > 0.05971479415893555) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000084; scores[1] += 0.000609; scores[2] += -0.000525; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.036306; scores[1] += -0.034443; scores[2] += -0.001863; break;
      case 3: scores[0] += -0.004940; scores[1] += 0.002234; scores[2] += 0.002706; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.010391; scores[1] += -0.008817; scores[2] += 0.019208; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.043693; scores[1] += 0.051275; scores[2] += -0.007582; break;
      case 12: scores[0] += 0.003893; scores[1] += -0.002098; scores[2] += -0.001796; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.021134; scores[1] += -0.037574; scores[2] += 0.016440; break;
    }
  }

  // Tree 280 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[44] > 0.25) << 1) | ((features[27] > 0.5) << 2) | ((features[10] > 5.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.014127; scores[1] += 0.003438; scores[2] += -0.017565; break;
      case 1: scores[0] += 0.004469; scores[1] += -0.001760; scores[2] += -0.002708; break;
      case 2: scores[0] += -0.004406; scores[1] += -0.003074; scores[2] += 0.007480; break;
      case 3: scores[0] += -0.012140; scores[1] += 0.001488; scores[2] += 0.010651; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.000539; scores[1] += 0.005589; scores[2] += -0.005050; break;
      case 6: scores[0] += -0.000024; scores[1] += -0.001961; scores[2] += 0.001985; break;
      case 7: scores[0] += -0.003429; scores[1] += 0.011585; scores[2] += -0.008156; break;
      case 8: scores[0] += -0.000080; scores[1] += -0.001280; scores[2] += 0.001360; break;
      case 9: scores[0] += -0.008010; scores[1] += -0.017304; scores[2] += 0.025314; break;
      case 10: scores[0] += -0.000644; scores[1] += 0.001785; scores[2] += -0.001141; break;
      case 11: scores[0] += 0.005115; scores[1] += 0.013117; scores[2] += -0.018232; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.009901; scores[1] += -0.006312; scores[2] += -0.003589; break;
      case 14: scores[0] += 0.003394; scores[1] += -0.016609; scores[2] += 0.013215; break;
      case 15: scores[0] += -0.014601; scores[1] += -0.013646; scores[2] += 0.028247; break;
    }
  }

  // Tree 281 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[9] > 2.5) << 1) | ((features[10] > 6.449999809265137) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000837; scores[1] += 0.008348; scores[2] += -0.009185; break;
      case 1: scores[0] += 0.007271; scores[1] += 0.000790; scores[2] += -0.008062; break;
      case 2: scores[0] += 0.018023; scores[1] += -0.007022; scores[2] += -0.011001; break;
      case 3: scores[0] += -0.004684; scores[1] += -0.001350; scores[2] += 0.006034; break;
      case 4: scores[0] += 0.003201; scores[1] += -0.000271; scores[2] += -0.002930; break;
      case 5: scores[0] += -0.014378; scores[1] += -0.013447; scores[2] += 0.027825; break;
      case 6: scores[0] += -0.003601; scores[1] += 0.001157; scores[2] += 0.002445; break;
      case 7: scores[0] += 0.004311; scores[1] += -0.008189; scores[2] += 0.003877; break;
      case 8: scores[0] += -0.001231; scores[1] += -0.025108; scores[2] += 0.026339; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.006257; scores[1] += 0.013013; scores[2] += -0.006756; break;
      case 11: scores[0] += -0.000010; scores[1] += 0.000591; scores[2] += -0.000581; break;
      case 12: scores[0] += -0.006646; scores[1] += -0.000370; scores[2] += 0.007016; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.005783; scores[1] += 0.005059; scores[2] += 0.000725; break;
      case 15: scores[0] += -0.000007; scores[1] += 0.001137; scores[2] += -0.001129; break;
    }
  }

  // Tree 282 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[11] > 0.027402402833104134) << 1) | ((features[10] > 11.416666030883789) << 2) | ((features[11] > 0.037749290466308594) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003470; scores[1] += -0.002401; scores[2] += -0.001068; break;
      case 1: scores[0] += 0.028263; scores[1] += -0.014342; scores[2] += -0.013920; break;
      case 2: scores[0] += -0.009815; scores[1] += -0.013316; scores[2] += 0.023131; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.007370; scores[1] += 0.025043; scores[2] += -0.017673; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003971; scores[1] += 0.001415; scores[2] += 0.002556; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001392; scores[1] += 0.005199; scores[2] += -0.003807; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.010790; scores[1] += -0.028437; scores[2] += 0.017646; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 283 (depth=4)
  {
    const leafIdx = ((features[5] > 0.5) << 0) | ((features[23] > 0.5) << 1) | ((features[35] > 0.5) << 2) | ((features[13] > 0.27681994438171387) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002673; scores[1] += 0.006419; scores[2] += -0.003746; break;
      case 1: scores[0] += 0.028602; scores[1] += -0.020554; scores[2] += -0.008048; break;
      case 2: scores[0] += -0.004129; scores[1] += 0.028236; scores[2] += -0.024108; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.010836; scores[1] += -0.007969; scores[2] += 0.018805; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.005084; scores[1] += 0.030822; scores[2] += -0.025737; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000807; scores[1] += -0.003196; scores[2] += 0.004003; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.006297; scores[1] += 0.004887; scores[2] += -0.011184; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.006265; scores[1] += 0.033503; scores[2] += -0.027237; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 284 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9743589758872986) << 0) | ((features[13] > 0.9183333516120911) << 1) | ((features[10] > 6.449999809265137) << 2) | ((features[10] > 7.550000190734863) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009696; scores[1] += -0.001390; scores[2] += -0.008306; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.023943; scores[1] += -0.045759; scores[2] += 0.021815; break;
      case 3: scores[0] += -0.002665; scores[1] += 0.009441; scores[2] += -0.006776; break;
      case 4: scores[0] += -0.022552; scores[1] += 0.005766; scores[2] += 0.016787; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.012591; scores[1] += 0.004891; scores[2] += -0.017482; break;
      case 7: scores[0] += -0.000007; scores[1] += -0.012935; scores[2] += 0.012943; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.001166; scores[1] += 0.001517; scores[2] += -0.002683; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.014048; scores[1] += -0.009218; scores[2] += -0.004831; break;
      case 15: scores[0] += -0.003543; scores[1] += -0.001525; scores[2] += 0.005068; break;
    }
  }

  // Tree 285 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8164982795715332) << 0) | ((features[13] > 0.39208072423934937) << 1) | ((features[10] > 9.416666030883789) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004169; scores[1] += 0.008744; scores[2] += -0.004575; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.008491; scores[1] += -0.034428; scores[2] += 0.025937; break;
      case 3: scores[0] += -0.006812; scores[1] += 0.017865; scores[2] += -0.011053; break;
      case 4: scores[0] += 0.004059; scores[1] += -0.007861; scores[2] += 0.003802; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.009521; scores[1] += 0.024965; scores[2] += -0.015444; break;
      case 7: scores[0] += 0.001021; scores[1] += 0.009297; scores[2] += -0.010318; break;
      case 8: scores[0] += 0.002482; scores[1] += -0.000011; scores[2] += -0.002471; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002352; scores[1] += 0.000788; scores[2] += 0.001565; break;
      case 11: scores[0] += 0.004303; scores[1] += 0.004022; scores[2] += -0.008326; break;
      case 12: scores[0] += -0.004455; scores[1] += 0.005631; scores[2] += -0.001176; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.007238; scores[1] += 0.001671; scores[2] += 0.005566; break;
      case 15: scores[0] += 0.006512; scores[1] += -0.011665; scores[2] += 0.005153; break;
    }
  }

  // Tree 286 (depth=4)
  {
    const leafIdx = ((features[43] > 0.71875) << 0) | ((features[10] > 7.2916669845581055) << 1) | ((features[10] > 5.224999904632568) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.013908; scores[1] += -0.002702; scores[2] += -0.011206; break;
      case 1: scores[0] += 0.004254; scores[1] += -0.000931; scores[2] += -0.003322; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.016429; scores[1] += 0.012155; scores[2] += 0.004273; break;
      case 5: scores[0] += -0.001369; scores[1] += -0.020166; scores[2] += 0.021535; break;
      case 6: scores[0] += 0.002502; scores[1] += -0.003575; scores[2] += 0.001073; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.011327; scores[1] += 0.003878; scores[2] += 0.007448; break;
      case 9: scores[0] += -0.011119; scores[1] += 0.019270; scores[2] += -0.008150; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.009124; scores[1] += -0.002302; scores[2] += -0.006822; break;
      case 13: scores[0] += 0.000653; scores[1] += -0.019064; scores[2] += 0.018411; break;
      case 14: scores[0] += -0.002479; scores[1] += 0.001148; scores[2] += 0.001331; break;
      case 15: scores[0] += -0.010029; scores[1] += 0.011972; scores[2] += -0.001943; break;
    }
  }

  // Tree 287 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8321678638458252) << 0) | ((features[13] > 0.8550419807434082) << 1) | ((features[31] > 0.5) << 2) | ((features[10] > 5.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004676; scores[1] += -0.005794; scores[2] += 0.001119; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.004493; scores[1] += 0.002102; scores[2] += -0.006595; break;
      case 4: scores[0] += 0.010943; scores[1] += 0.001373; scores[2] += -0.012316; break;
      case 5: scores[0] += -0.001735; scores[1] += -0.020517; scores[2] += 0.022252; break;
      case 6: scores[0] += -0.000749; scores[1] += 0.002866; scores[2] += -0.002117; break;
      case 7: scores[0] += -0.006594; scores[1] += 0.028560; scores[2] += -0.021966; break;
      case 8: scores[0] += -0.001433; scores[1] += -0.000942; scores[2] += 0.002375; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.013811; scores[1] += 0.019167; scores[2] += -0.032978; break;
      case 11: scores[0] += -0.004490; scores[1] += -0.002469; scores[2] += 0.006959; break;
      case 12: scores[0] += 0.000936; scores[1] += 0.008244; scores[2] += -0.009180; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000454; scores[1] += -0.004489; scores[2] += 0.004943; break;
      case 15: scores[0] += -0.006103; scores[1] += -0.022844; scores[2] += 0.028946; break;
    }
  }

  // Tree 288 (depth=4)
  {
    const leafIdx = ((features[10] > 8.416666030883789) << 0) | ((features[33] > 0.5) << 1) | ((features[13] > 0.9183333516120911) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001716; scores[1] += -0.003676; scores[2] += 0.005392; break;
      case 1: scores[0] += 0.011017; scores[1] += -0.001206; scores[2] += -0.009811; break;
      case 2: scores[0] += -0.003828; scores[1] += 0.001906; scores[2] += 0.001922; break;
      case 3: scores[0] += -0.022713; scores[1] += 0.013301; scores[2] += 0.009412; break;
      case 4: scores[0] += -0.006344; scores[1] += 0.000553; scores[2] += 0.005791; break;
      case 5: scores[0] += 0.011288; scores[1] += 0.003472; scores[2] += -0.014761; break;
      case 6: scores[0] += -0.011129; scores[1] += 0.000547; scores[2] += 0.010582; break;
      case 7: scores[0] += 0.007669; scores[1] += -0.027765; scores[2] += 0.020096; break;
      case 8: scores[0] += 0.002850; scores[1] += -0.001170; scores[2] += -0.001681; break;
      case 9: scores[0] += -0.001886; scores[1] += -0.001363; scores[2] += 0.003249; break;
      case 10: scores[0] += -0.033461; scores[1] += 0.019807; scores[2] += 0.013655; break;
      case 11: scores[0] += 0.026034; scores[1] += 0.002262; scores[2] += -0.028296; break;
      case 12: scores[0] += -0.014741; scores[1] += 0.029224; scores[2] += -0.014484; break;
      case 13: scores[0] += -0.010014; scores[1] += -0.007445; scores[2] += 0.017459; break;
      case 14: scores[0] += 0.022512; scores[1] += -0.025953; scores[2] += 0.003441; break;
      case 15: scores[0] += -0.010443; scores[1] += 0.025005; scores[2] += -0.014563; break;
    }
  }

  // Tree 289 (depth=4)
  {
    const leafIdx = ((features[11] > 0.033908046782016754) << 0) | ((features[2] > 0.5) << 1) | ((features[33] > 0.5) << 2) | ((features[31] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005076; scores[1] += 0.000621; scores[2] += 0.004454; break;
      case 1: scores[0] += 0.015126; scores[1] += -0.005693; scores[2] += -0.009432; break;
      case 2: scores[0] += -0.001185; scores[1] += 0.026515; scores[2] += -0.025330; break;
      case 3: scores[0] += 0.012470; scores[1] += -0.015822; scores[2] += 0.003352; break;
      case 4: scores[0] += 0.011009; scores[1] += 0.014066; scores[2] += -0.025075; break;
      case 5: scores[0] += -0.017394; scores[1] += -0.009468; scores[2] += 0.026862; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.011193; scores[1] += -0.032270; scores[2] += 0.021077; break;
      case 8: scores[0] += 0.026092; scores[1] += 0.000759; scores[2] += -0.026850; break;
      case 9: scores[0] += 0.019733; scores[1] += -0.006062; scores[2] += -0.013671; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.019282; scores[1] += 0.008794; scores[2] += 0.010488; break;
      case 12: scores[0] += -0.000835; scores[1] += -0.015543; scores[2] += 0.016378; break;
      case 13: scores[0] += -0.002153; scores[1] += 0.026535; scores[2] += -0.024382; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.004977; scores[1] += -0.018817; scores[2] += 0.013840; break;
    }
  }

  // Tree 290 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[4] > 0.5) << 1) | ((features[10] > 10.833333969116211) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.015397; scores[1] += 0.009590; scores[2] += 0.005807; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000254; scores[1] += -0.019606; scores[2] += 0.019860; break;
      case 3: scores[0] += 0.007244; scores[1] += 0.000775; scores[2] += -0.008019; break;
      case 4: scores[0] += -0.001671; scores[1] += -0.005352; scores[2] += 0.007023; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.014425; scores[1] += 0.020974; scores[2] += -0.035399; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002507; scores[1] += -0.001548; scores[2] += -0.000959; break;
      case 9: scores[0] += -0.000611; scores[1] += -0.006231; scores[2] += 0.006842; break;
      case 10: scores[0] += 0.018317; scores[1] += 0.016507; scores[2] += -0.034824; break;
      case 11: scores[0] += -0.013978; scores[1] += -0.012782; scores[2] += 0.026760; break;
      case 12: scores[0] += -0.020207; scores[1] += 0.023292; scores[2] += -0.003085; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.021348; scores[1] += 0.001627; scores[2] += 0.019721; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 291 (depth=4)
  {
    const leafIdx = ((features[43] > 0.15894736349582672) << 0) | ((features[43] > 0.17028985917568207) << 1) | ((features[10] > 10.833333969116211) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003157; scores[1] += -0.000638; scores[2] += -0.002519; break;
      case 1: scores[0] += -0.019901; scores[1] += 0.014427; scores[2] += 0.005474; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.006170; scores[1] += -0.000407; scores[2] += 0.006577; break;
      case 4: scores[0] += -0.006874; scores[1] += 0.013238; scores[2] += -0.006364; break;
      case 5: scores[0] += -0.008754; scores[1] += -0.042415; scores[2] += 0.051169; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.021952; scores[1] += 0.007245; scores[2] += 0.014707; break;
      case 8: scores[0] += 0.005830; scores[1] += -0.025760; scores[2] += 0.019930; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.002601; scores[1] += -0.001934; scores[2] += -0.000667; break;
      case 12: scores[0] += 0.013258; scores[1] += 0.017225; scores[2] += -0.030483; break;
      case 13: scores[0] += -0.002671; scores[1] += 0.005480; scores[2] += -0.002809; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.018010; scores[1] += 0.007677; scores[2] += 0.010333; break;
    }
  }

  // Tree 292 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[13] > 0.5345238447189331) << 2) | ((features[13] > 0.4843597412109375) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009400; scores[1] += -0.006546; scores[2] += -0.002854; break;
      case 1: scores[0] += -0.002232; scores[1] += -0.006007; scores[2] += 0.008238; break;
      case 2: scores[0] += 0.000347; scores[1] += -0.000835; scores[2] += 0.000487; break;
      case 3: scores[0] += -0.006851; scores[1] += 0.022369; scores[2] += -0.015518; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.001221; scores[1] += -0.020182; scores[2] += 0.018961; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.015591; scores[1] += -0.011460; scores[2] += 0.027051; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000230; scores[1] += 0.004214; scores[2] += -0.003985; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.002672; scores[1] += 0.003599; scores[2] += -0.006272; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 293 (depth=4)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[13] > 0.44058823585510254) << 1) | ((features[11] > 0.07059800624847412) << 2) | ((features[13] > 0.4821200370788574) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000111; scores[1] += -0.000295; scores[2] += 0.000406; break;
      case 1: scores[0] += -0.011113; scores[1] += 0.021737; scores[2] += -0.010625; break;
      case 2: scores[0] += -0.003017; scores[1] += -0.016886; scores[2] += 0.019902; break;
      case 3: scores[0] += -0.006786; scores[1] += 0.017081; scores[2] += -0.010295; break;
      case 4: scores[0] += 0.005813; scores[1] += 0.002633; scores[2] += -0.008446; break;
      case 5: scores[0] += -0.029417; scores[1] += -0.006150; scores[2] += 0.035567; break;
      case 6: scores[0] += 0.004827; scores[1] += -0.017760; scores[2] += 0.012934; break;
      case 7: scores[0] += 0.044539; scores[1] += -0.006718; scores[2] += -0.037821; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.003434; scores[1] += 0.000499; scores[2] += 0.002935; break;
      case 11: scores[0] += -0.007119; scores[1] += -0.002171; scores[2] += 0.009290; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.010714; scores[1] += 0.012109; scores[2] += -0.022823; break;
      case 15: scores[0] += 0.010263; scores[1] += -0.003108; scores[2] += -0.007155; break;
    }
  }

  // Tree 294 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[13] > 0.6191683411598206) << 1) | ((features[11] > 0.1558704376220703) << 2) | ((features[10] > 6.099999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007781; scores[1] += -0.010943; scores[2] += 0.003163; break;
      case 1: scores[0] += -0.000578; scores[1] += 0.005773; scores[2] += -0.005195; break;
      case 2: scores[0] += -0.004902; scores[1] += 0.009113; scores[2] += -0.004211; break;
      case 3: scores[0] += -0.000806; scores[1] += 0.001825; scores[2] += -0.001018; break;
      case 4: scores[0] += 0.026903; scores[1] += -0.011856; scores[2] += -0.015047; break;
      case 5: scores[0] += -0.011661; scores[1] += 0.001353; scores[2] += 0.010308; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.006056; scores[1] += 0.002138; scores[2] += 0.003918; break;
      case 9: scores[0] += -0.017517; scores[1] += 0.016917; scores[2] += 0.000600; break;
      case 10: scores[0] += 0.003062; scores[1] += -0.002893; scores[2] += -0.000169; break;
      case 11: scores[0] += -0.001328; scores[1] += 0.022926; scores[2] += -0.021599; break;
      case 12: scores[0] += 0.017819; scores[1] += 0.019043; scores[2] += -0.036862; break;
      case 13: scores[0] += -0.003559; scores[1] += 0.007049; scores[2] += -0.003490; break;
      case 14: scores[0] += 0.000587; scores[1] += -0.000443; scores[2] += -0.000144; break;
      case 15: scores[0] += 0.012668; scores[1] += -0.010207; scores[2] += -0.002460; break;
    }
  }

  // Tree 295 (depth=4)
  {
    const leafIdx = ((features[11] > 0.2679487466812134) << 0) | ((features[9] > 1.5) << 1) | ((features[11] > 0.19615384936332703) << 2) | ((features[11] > 0.2124060094356537) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003169; scores[1] += -0.002006; scores[2] += -0.001163; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.004169; scores[1] += 0.002268; scores[2] += 0.001901; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000396; scores[1] += -0.000064; scores[2] += -0.000332; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.008711; scores[1] += 0.033205; scores[2] += -0.024494; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000787; scores[1] += -0.000196; scores[2] += -0.000592; break;
      case 13: scores[0] += 0.008631; scores[1] += -0.004351; scores[2] += -0.004281; break;
      case 14: scores[0] += 0.018490; scores[1] += 0.005596; scores[2] += -0.024086; break;
      case 15: scores[0] += -0.009596; scores[1] += -0.023167; scores[2] += 0.032764; break;
    }
  }

  // Tree 296 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5285947918891907) << 0) | ((features[13] > 0.4654761850833893) << 1) | ((features[10] > 6.366666793823242) << 2) | ((features[44] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.017958; scores[1] += -0.014246; scores[2] += -0.003712; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.027296; scores[1] += 0.029737; scores[2] += -0.002441; break;
      case 4: scores[0] += 0.013807; scores[1] += -0.017636; scores[2] += 0.003829; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001177; scores[1] += 0.002933; scores[2] += -0.001756; break;
      case 7: scores[0] += 0.007235; scores[1] += 0.007429; scores[2] += -0.014663; break;
      case 8: scores[0] += -0.004569; scores[1] += 0.006998; scores[2] += -0.002429; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.010257; scores[1] += -0.045713; scores[2] += 0.035456; break;
      case 11: scores[0] += 0.008973; scores[1] += 0.004162; scores[2] += -0.013135; break;
      case 12: scores[0] += -0.013962; scores[1] += 0.007557; scores[2] += 0.006405; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.013801; scores[1] += -0.001405; scores[2] += 0.015207; break;
      case 15: scores[0] += 0.002184; scores[1] += 0.000528; scores[2] += -0.002711; break;
    }
  }

  // Tree 297 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[13] > 0.42206478118896484) << 1) | ((features[13] > 0.4202037453651428) << 2) | ((features[10] > 4.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003189; scores[1] += 0.005880; scores[2] += -0.009069; break;
      case 1: scores[0] += -0.000341; scores[1] += 0.003777; scores[2] += -0.003436; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001103; scores[1] += -0.033663; scores[2] += 0.034767; break;
      case 7: scores[0] += -0.027333; scores[1] += 0.013239; scores[2] += 0.014094; break;
      case 8: scores[0] += -0.003162; scores[1] += 0.002526; scores[2] += 0.000636; break;
      case 9: scores[0] += -0.002872; scores[1] += 0.016710; scores[2] += -0.013838; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001450; scores[1] += 0.016602; scores[2] += -0.015152; break;
      case 13: scores[0] += -0.000030; scores[1] += 0.026215; scores[2] += -0.026185; break;
      case 14: scores[0] += 0.002219; scores[1] += -0.003113; scores[2] += 0.000895; break;
      case 15: scores[0] += 0.005800; scores[1] += -0.007306; scores[2] += 0.001507; break;
    }
  }

  // Tree 298 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[22] > 0.5) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000041; scores[1] += 0.004708; scores[2] += -0.004749; break;
      case 1: scores[0] += 0.009725; scores[1] += -0.018027; scores[2] += 0.008302; break;
      case 2: scores[0] += -0.005411; scores[1] += -0.017483; scores[2] += 0.022895; break;
      case 3: scores[0] += -0.000975; scores[1] += 0.014866; scores[2] += -0.013890; break;
      case 4: scores[0] += -0.028194; scores[1] += 0.013975; scores[2] += 0.014219; break;
      case 5: scores[0] += -0.003549; scores[1] += -0.014596; scores[2] += 0.018146; break;
      case 6: scores[0] += 0.008601; scores[1] += 0.014290; scores[2] += -0.022891; break;
      case 7: scores[0] += -0.001676; scores[1] += -0.000011; scores[2] += 0.001687; break;
      case 8: scores[0] += 0.001747; scores[1] += 0.000348; scores[2] += -0.002095; break;
      case 9: scores[0] += -0.006783; scores[1] += -0.023466; scores[2] += 0.030249; break;
      case 10: scores[0] += -0.013800; scores[1] += 0.023326; scores[2] += -0.009525; break;
      case 11: scores[0] += -0.003038; scores[1] += 0.017678; scores[2] += -0.014640; break;
      case 12: scores[0] += 0.021360; scores[1] += -0.011774; scores[2] += -0.009586; break;
      case 13: scores[0] += -0.007863; scores[1] += 0.002261; scores[2] += 0.005602; break;
      case 14: scores[0] += -0.001140; scores[1] += -0.017466; scores[2] += 0.018607; break;
      case 15: scores[0] += -0.000406; scores[1] += 0.012162; scores[2] += -0.011756; break;
    }
  }

  // Tree 299 (depth=4)
  {
    const leafIdx = ((features[34] > 0.15000000596046448) << 0) | ((features[13] > 0.8164982795715332) << 1) | ((features[13] > 0.8245074152946472) << 2) | ((features[10] > 7.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003382; scores[1] += -0.005192; scores[2] += 0.001810; break;
      case 1: scores[0] += -0.000027; scores[1] += 0.008793; scores[2] += -0.008766; break;
      case 2: scores[0] += -0.000219; scores[1] += 0.003160; scores[2] += -0.002941; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000883; scores[1] += 0.003623; scores[2] += -0.004507; break;
      case 7: scores[0] += -0.006041; scores[1] += 0.018137; scores[2] += -0.012096; break;
      case 8: scores[0] += -0.006667; scores[1] += 0.002214; scores[2] += 0.004453; break;
      case 9: scores[0] += 0.005813; scores[1] += 0.000197; scores[2] += -0.006010; break;
      case 10: scores[0] += 0.025799; scores[1] += 0.011663; scores[2] += -0.037462; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002702; scores[1] += -0.000784; scores[2] += 0.003486; break;
      case 15: scores[0] += 0.014983; scores[1] += -0.013126; scores[2] += -0.001858; break;
    }
  }

  // Tree 300 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8550419807434082) << 0) | ((features[31] > 0.5) << 1) | ((features[13] > 0.8360214829444885) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003193; scores[1] += -0.001297; scores[2] += -0.001897; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.013800; scores[1] += 0.008964; scores[2] += 0.004836; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.000358; scores[1] += 0.001678; scores[2] += -0.001320; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.012755; scores[1] += -0.024190; scores[2] += 0.011434; break;
      case 8: scores[0] += -0.010213; scores[1] += 0.002613; scores[2] += 0.007601; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.009380; scores[1] += 0.002808; scores[2] += -0.012188; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.026127; scores[1] += 0.007223; scores[2] += -0.033349; break;
      case 13: scores[0] += 0.010387; scores[1] += 0.017281; scores[2] += -0.027668; break;
      case 14: scores[0] += -0.001575; scores[1] += -0.020062; scores[2] += 0.021637; break;
      case 15: scores[0] += -0.006201; scores[1] += 0.007136; scores[2] += -0.000934; break;
    }
  }

  // Tree 301 (depth=4)
  {
    const leafIdx = ((features[43] > 0.41885966062545776) << 0) | ((features[13] > 0.42206478118896484) << 1) | ((features[43] > 0.2928921580314636) << 2) | ((features[10] > 8.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.012209; scores[1] += 0.008275; scores[2] += 0.003934; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000762; scores[1] += -0.006192; scores[2] += 0.006954; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.003123; scores[1] += -0.014240; scores[2] += 0.017363; break;
      case 5: scores[0] += -0.000031; scores[1] += 0.026069; scores[2] += -0.026038; break;
      case 6: scores[0] += -0.011680; scores[1] += 0.009539; scores[2] += 0.002141; break;
      case 7: scores[0] += -0.003298; scores[1] += -0.002014; scores[2] += 0.005312; break;
      case 8: scores[0] += 0.003072; scores[1] += 0.001010; scores[2] += -0.004082; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000411; scores[1] += -0.001469; scores[2] += 0.001057; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.004281; scores[1] += 0.011540; scores[2] += -0.007259; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.044666; scores[1] += -0.025818; scores[2] += -0.018848; break;
      case 15: scores[0] += -0.003611; scores[1] += 0.003209; scores[2] += 0.000403; break;
    }
  }

  // Tree 302 (depth=4)
  {
    const leafIdx = ((features[9] > 1.5) << 0) | ((features[10] > 11.833333969116211) << 1) | ((features[11] > 0.08957219123840332) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005967; scores[1] += -0.029540; scores[2] += 0.023572; break;
      case 1: scores[0] += 0.011917; scores[1] += -0.007120; scores[2] += -0.004797; break;
      case 2: scores[0] += -0.006203; scores[1] += 0.027880; scores[2] += -0.021676; break;
      case 3: scores[0] += -0.018433; scores[1] += 0.006590; scores[2] += 0.011843; break;
      case 4: scores[0] += 0.010789; scores[1] += -0.003914; scores[2] += -0.006875; break;
      case 5: scores[0] += -0.024229; scores[1] += 0.014396; scores[2] += 0.009834; break;
      case 6: scores[0] += 0.013718; scores[1] += -0.004497; scores[2] += -0.009220; break;
      case 7: scores[0] += -0.019922; scores[1] += -0.006767; scores[2] += 0.026689; break;
      case 8: scores[0] += 0.003287; scores[1] += -0.001613; scores[2] += -0.001675; break;
      case 9: scores[0] += -0.003151; scores[1] += 0.005099; scores[2] += -0.001949; break;
      case 10: scores[0] += -0.000343; scores[1] += -0.009000; scores[2] += 0.009343; break;
      case 11: scores[0] += 0.000815; scores[1] += -0.027587; scores[2] += 0.026772; break;
      case 12: scores[0] += 0.000457; scores[1] += -0.000380; scores[2] += -0.000076; break;
      case 13: scores[0] += 0.004264; scores[1] += 0.009034; scores[2] += -0.013298; break;
      case 14: scores[0] += 0.010667; scores[1] += -0.004900; scores[2] += -0.005767; break;
      case 15: scores[0] += 0.016922; scores[1] += -0.011378; scores[2] += -0.005543; break;
    }
  }

  // Tree 303 (depth=4)
  {
    const leafIdx = ((features[10] > 6.775000095367432) << 0) | ((features[4] > 0.5) << 1) | ((features[43] > 0.4104278087615967) << 2) | ((features[10] > 5.633333206176758) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005602; scores[1] += 0.004171; scores[2] += 0.001431; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.013115; scores[1] += -0.010888; scores[2] += -0.002228; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.015030; scores[1] += 0.013057; scores[2] += 0.001973; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.004470; scores[1] += -0.001280; scores[2] += -0.003190; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.001757; scores[1] += -0.003830; scores[2] += 0.002073; break;
      case 9: scores[0] += -0.002130; scores[1] += 0.001963; scores[2] += 0.000168; break;
      case 10: scores[0] += -0.016664; scores[1] += 0.019958; scores[2] += -0.003294; break;
      case 11: scores[0] += 0.006077; scores[1] += -0.003788; scores[2] += -0.002289; break;
      case 12: scores[0] += -0.002117; scores[1] += 0.020811; scores[2] += -0.018694; break;
      case 13: scores[0] += -0.003157; scores[1] += -0.013378; scores[2] += 0.016534; break;
      case 14: scores[0] += -0.001590; scores[1] += -0.019287; scores[2] += 0.020877; break;
      case 15: scores[0] += -0.003633; scores[1] += 0.008277; scores[2] += -0.004644; break;
    }
  }

  // Tree 304 (depth=4)
  {
    const leafIdx = ((features[11] > 0.027402402833104134) << 0) | ((features[11] > 0.035098522901535034) << 1) | ((features[13] > 0.12310606241226196) << 2) | ((features[13] > 0.1558704376220703) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006640; scores[1] += 0.000933; scores[2] += -0.007573; break;
      case 1: scores[0] += -0.003260; scores[1] += -0.025893; scores[2] += 0.029153; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.011007; scores[1] += 0.013910; scores[2] += -0.002903; break;
      case 4: scores[0] += -0.005777; scores[1] += 0.028120; scores[2] += -0.022343; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.013393; scores[1] += -0.041478; scores[2] += 0.054871; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002664; scores[1] += -0.000227; scores[2] += 0.002891; break;
      case 13: scores[0] += -0.008292; scores[1] += 0.008780; scores[2] += -0.000488; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.008369; scores[1] += -0.003688; scores[2] += -0.004681; break;
    }
  }

  // Tree 305 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[13] > 0.521164059638977) << 1) | ((features[13] > 0.5857863426208496) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005678; scores[1] += 0.000319; scores[2] += -0.005997; break;
      case 1: scores[0] += -0.002359; scores[1] += -0.001710; scores[2] += 0.004069; break;
      case 2: scores[0] += -0.000096; scores[1] += 0.000299; scores[2] += -0.000203; break;
      case 3: scores[0] += 0.010359; scores[1] += -0.001011; scores[2] += -0.009348; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.024070; scores[1] += 0.014395; scores[2] += 0.009675; break;
      case 7: scores[0] += 0.009797; scores[1] += 0.003432; scores[2] += -0.013230; break;
      case 8: scores[0] += -0.000097; scores[1] += 0.001128; scores[2] += -0.001031; break;
      case 9: scores[0] += -0.001682; scores[1] += 0.001281; scores[2] += 0.000400; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.007737; scores[1] += 0.022789; scores[2] += -0.030527; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.015057; scores[1] += -0.005861; scores[2] += 0.020918; break;
    }
  }

  // Tree 306 (depth=4)
  {
    const leafIdx = ((features[13] > 0.39208072423934937) << 0) | ((features[0] > 0.5) << 1) | ((features[2] > 0.5) << 2) | ((features[11] > 0.04446640610694885) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003657; scores[1] += 0.005284; scores[2] += -0.001627; break;
      case 1: scores[0] += -0.003827; scores[1] += -0.003442; scores[2] += 0.007268; break;
      case 2: scores[0] += 0.000155; scores[1] += -0.000027; scores[2] += -0.000128; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.003592; scores[1] += 0.004186; scores[2] += -0.000594; break;
      case 5: scores[0] += -0.001096; scores[1] += 0.026527; scores[2] += -0.025431; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.008144; scores[1] += -0.001115; scores[2] += 0.009259; break;
      case 9: scores[0] += 0.001539; scores[1] += 0.018048; scores[2] += -0.019587; break;
      case 10: scores[0] += 0.033906; scores[1] += -0.018032; scores[2] += -0.015873; break;
      case 11: scores[0] += -0.017282; scores[1] += 0.018850; scores[2] += -0.001569; break;
      case 12: scores[0] += -0.000392; scores[1] += 0.030622; scores[2] += -0.030230; break;
      case 13: scores[0] += 0.004524; scores[1] += -0.029386; scores[2] += 0.024861; break;
      case 14: scores[0] += -0.006848; scores[1] += -0.016933; scores[2] += 0.023781; break;
      case 15: scores[0] += 0.036176; scores[1] += -0.018585; scores[2] += -0.017592; break;
    }
  }

  // Tree 307 (depth=4)
  {
    const leafIdx = ((features[13] > 0.568323016166687) << 0) | ((features[19] > 0.5) << 1) | ((features[34] > 0.05000000074505806) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005628; scores[1] += -0.003118; scores[2] += -0.002510; break;
      case 1: scores[0] += -0.025433; scores[1] += 0.028677; scores[2] += -0.003244; break;
      case 2: scores[0] += 0.022966; scores[1] += -0.004630; scores[2] += -0.018336; break;
      case 3: scores[0] += -0.008266; scores[1] += 0.034263; scores[2] += -0.025997; break;
      case 4: scores[0] += 0.018249; scores[1] += -0.041403; scores[2] += 0.023154; break;
      case 5: scores[0] += 0.026637; scores[1] += -0.031168; scores[2] += 0.004531; break;
      case 6: scores[0] += -0.002746; scores[1] += -0.008192; scores[2] += 0.010938; break;
      case 7: scores[0] += -0.006204; scores[1] += -0.007460; scores[2] += 0.013664; break;
      case 8: scores[0] += -0.028464; scores[1] += -0.003962; scores[2] += 0.032426; break;
      case 9: scores[0] += 0.034348; scores[1] += -0.021568; scores[2] += -0.012780; break;
      case 10: scores[0] += -0.003722; scores[1] += 0.004403; scores[2] += -0.000681; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.018349; scores[1] += 0.023293; scores[2] += -0.004944; break;
      case 13: scores[0] += -0.002512; scores[1] += -0.000146; scores[2] += 0.002658; break;
      case 14: scores[0] += 0.023171; scores[1] += -0.007500; scores[2] += -0.015670; break;
      case 15: scores[0] += 0.006593; scores[1] += -0.001636; scores[2] += -0.004957; break;
    }
  }

  // Tree 308 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.5285947918891907) << 1) | ((features[19] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.017553; scores[1] += 0.004884; scores[2] += 0.012669; break;
      case 1: scores[0] += 0.022596; scores[1] += -0.010564; scores[2] += -0.012032; break;
      case 2: scores[0] += 0.005219; scores[1] += 0.016946; scores[2] += -0.022165; break;
      case 3: scores[0] += 0.004335; scores[1] += -0.002654; scores[2] += -0.001682; break;
      case 4: scores[0] += 0.021544; scores[1] += -0.000633; scores[2] += -0.020911; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.009911; scores[1] += 0.023228; scores[2] += -0.013317; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.010345; scores[1] += 0.008837; scores[2] += 0.001508; break;
      case 9: scores[0] += 0.002298; scores[1] += -0.000914; scores[2] += -0.001383; break;
      case 10: scores[0] += 0.001728; scores[1] += -0.001043; scores[2] += -0.000685; break;
      case 11: scores[0] += 0.003378; scores[1] += -0.002037; scores[2] += -0.001341; break;
      case 12: scores[0] += 0.004575; scores[1] += -0.008712; scores[2] += 0.004138; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.016971; scores[1] += -0.005536; scores[2] += -0.011435; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 309 (depth=4)
  {
    const leafIdx = ((features[11] > 0.027402402833104134) << 0) | ((features[11] > 0.039230771362781525) << 1) | ((features[40] > 0.5) << 2) | ((features[13] > 0.4721362292766571) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.008490; scores[1] += 0.001087; scores[2] += 0.007403; break;
      case 1: scores[0] += -0.001758; scores[1] += 0.002500; scores[2] += -0.000742; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.005687; scores[1] += -0.003023; scores[2] += -0.002663; break;
      case 4: scores[0] += 0.011660; scores[1] += 0.008562; scores[2] += -0.020222; break;
      case 5: scores[0] += -0.007908; scores[1] += -0.022470; scores[2] += 0.030378; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.001578; scores[1] += 0.001235; scores[2] += -0.002813; break;
      case 8: scores[0] += 0.006297; scores[1] += 0.002964; scores[2] += -0.009261; break;
      case 9: scores[0] += -0.003079; scores[1] += 0.036346; scores[2] += -0.033268; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.005382; scores[1] += -0.005884; scores[2] += 0.000502; break;
      case 12: scores[0] += -0.028722; scores[1] += 0.000623; scores[2] += 0.028099; break;
      case 13: scores[0] += -0.001350; scores[1] += -0.008874; scores[2] += 0.010224; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.004167; scores[1] += 0.000739; scores[2] += 0.003428; break;
    }
  }

  // Tree 310 (depth=4)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[9] > 2.5) << 1) | ((features[40] > 0.5) << 2) | ((features[23] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002415; scores[1] += 0.002800; scores[2] += -0.005215; break;
      case 1: scores[0] += -0.024903; scores[1] += -0.002558; scores[2] += 0.027461; break;
      case 2: scores[0] += 0.012483; scores[1] += -0.002773; scores[2] += -0.009710; break;
      case 3: scores[0] += -0.007541; scores[1] += -0.023590; scores[2] += 0.031132; break;
      case 4: scores[0] += 0.003513; scores[1] += -0.011133; scores[2] += 0.007620; break;
      case 5: scores[0] += 0.019198; scores[1] += -0.006554; scores[2] += -0.012644; break;
      case 6: scores[0] += -0.011477; scores[1] += -0.000244; scores[2] += 0.011721; break;
      case 7: scores[0] += 0.006340; scores[1] += 0.006162; scores[2] += -0.012502; break;
      case 8: scores[0] += -0.000902; scores[1] += 0.008251; scores[2] += -0.007350; break;
      case 9: scores[0] += -0.001434; scores[1] += 0.011670; scores[2] += -0.010235; break;
      case 10: scores[0] += -0.002536; scores[1] += 0.016794; scores[2] += -0.014258; break;
      case 11: scores[0] += -0.004620; scores[1] += 0.029259; scores[2] += -0.024639; break;
      case 12: scores[0] += -0.000764; scores[1] += 0.008688; scores[2] += -0.007924; break;
      case 13: scores[0] += -0.000473; scores[1] += 0.009974; scores[2] += -0.009501; break;
      case 14: scores[0] += -0.000498; scores[1] += 0.006607; scores[2] += -0.006109; break;
      case 15: scores[0] += -0.004793; scores[1] += 0.032859; scores[2] += -0.028065; break;
    }
  }

  // Tree 311 (depth=4)
  {
    const leafIdx = ((features[43] > 0.9285714626312256) << 0) | ((features[44] > 0.25) << 1) | ((features[10] > 7.4166669845581055) << 2) | ((features[13] > 0.9743589758872986) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006417; scores[1] += -0.001600; scores[2] += -0.004817; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.003888; scores[1] += -0.003327; scores[2] += -0.000561; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001776; scores[1] += 0.000881; scores[2] += 0.000894; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.004924; scores[1] += -0.001440; scores[2] += -0.003483; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.015814; scores[1] += 0.028354; scores[2] += -0.012540; break;
      case 9: scores[0] += 0.000864; scores[1] += -0.008193; scores[2] += 0.007329; break;
      case 10: scores[0] += -0.008232; scores[1] += 0.028983; scores[2] += -0.020751; break;
      case 11: scores[0] += -0.000636; scores[1] += 0.005559; scores[2] += -0.004922; break;
      case 12: scores[0] += 0.000723; scores[1] += -0.010287; scores[2] += 0.009564; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.012717; scores[1] += 0.002909; scores[2] += 0.009808; break;
      case 15: scores[0] += -0.012150; scores[1] += 0.005139; scores[2] += 0.007011; break;
    }
  }

  // Tree 312 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[10] > 10.833333969116211) << 2) | ((features[31] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001256; scores[1] += -0.003005; scores[2] += 0.001749; break;
      case 1: scores[0] += 0.006432; scores[1] += 0.001221; scores[2] += -0.007653; break;
      case 2: scores[0] += 0.002283; scores[1] += -0.001086; scores[2] += -0.001197; break;
      case 3: scores[0] += -0.016909; scores[1] += -0.005172; scores[2] += 0.022081; break;
      case 4: scores[0] += 0.001587; scores[1] += 0.007953; scores[2] += -0.009540; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.017532; scores[1] += 0.005989; scores[2] += 0.011543; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002206; scores[1] += -0.005448; scores[2] += 0.003242; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.005732; scores[1] += -0.000661; scores[2] += -0.005071; break;
      case 11: scores[0] += 0.003430; scores[1] += -0.012946; scores[2] += 0.009516; break;
      case 12: scores[0] += 0.011410; scores[1] += -0.029301; scores[2] += 0.017892; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.016542; scores[1] += 0.029276; scores[2] += -0.012733; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 313 (depth=4)
  {
    const leafIdx = ((features[10] > 4.7083330154418945) << 0) | ((features[13] > 0.46291208267211914) << 1) | ((features[10] > 4.633333206176758) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005781; scores[1] += -0.004483; scores[2] += -0.001298; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.023541; scores[1] += 0.012102; scores[2] += 0.011439; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001475; scores[1] += 0.005307; scores[2] += -0.003831; break;
      case 5: scores[0] += 0.001501; scores[1] += 0.000395; scores[2] += -0.001896; break;
      case 6: scores[0] += -0.000665; scores[1] += -0.035048; scores[2] += 0.035713; break;
      case 7: scores[0] += 0.000919; scores[1] += -0.001078; scores[2] += 0.000160; break;
      case 8: scores[0] += -0.002208; scores[1] += 0.012191; scores[2] += -0.009983; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.005589; scores[1] += -0.005767; scores[2] += 0.011357; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000013; scores[1] += 0.000082; scores[2] += -0.000069; break;
      case 13: scores[0] += -0.018570; scores[1] += 0.007046; scores[2] += 0.011523; break;
      case 14: scores[0] += -0.001540; scores[1] += 0.009364; scores[2] += -0.007824; break;
      case 15: scores[0] += 0.013122; scores[1] += -0.004707; scores[2] += -0.008416; break;
    }
  }

  // Tree 314 (depth=4)
  {
    const leafIdx = ((features[14] > 0.5) << 0) | ((features[2] > 0.5) << 1) | ((features[11] > 0.048199765384197235) << 2) | ((features[13] > 0.4721362292766571) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003734; scores[1] += -0.003537; scores[2] += -0.000197; break;
      case 1: scores[0] += -0.029130; scores[1] += 0.018956; scores[2] += 0.010174; break;
      case 2: scores[0] += -0.002740; scores[1] += -0.005372; scores[2] += 0.008112; break;
      case 3: scores[0] += -0.000573; scores[1] += 0.009806; scores[2] += -0.009233; break;
      case 4: scores[0] += 0.033794; scores[1] += -0.014880; scores[2] += -0.018914; break;
      case 5: scores[0] += -0.022718; scores[1] += 0.014746; scores[2] += 0.007973; break;
      case 6: scores[0] += -0.028958; scores[1] += 0.007477; scores[2] += 0.021481; break;
      case 7: scores[0] += 0.040975; scores[1] += -0.011336; scores[2] += -0.029640; break;
      case 8: scores[0] += -0.003586; scores[1] += 0.010588; scores[2] += -0.007002; break;
      case 9: scores[0] += 0.001885; scores[1] += -0.004046; scores[2] += 0.002161; break;
      case 10: scores[0] += -0.001145; scores[1] += 0.026086; scores[2] += -0.024941; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.006213; scores[1] += -0.010116; scores[2] += 0.003903; break;
      case 13: scores[0] += -0.000935; scores[1] += 0.023622; scores[2] += -0.022687; break;
      case 14: scores[0] += 0.002532; scores[1] += -0.007391; scores[2] += 0.004859; break;
      case 15: scores[0] += 0.013215; scores[1] += -0.032876; scores[2] += 0.019661; break;
    }
  }

  // Tree 315 (depth=4)
  {
    const leafIdx = ((features[10] > 8.291666030883789) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[43] > 0.26491230726242065) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006954; scores[1] += -0.006258; scores[2] += 0.013212; break;
      case 1: scores[0] += 0.013938; scores[1] += 0.006539; scores[2] += -0.020477; break;
      case 2: scores[0] += 0.002208; scores[1] += -0.000561; scores[2] += -0.001647; break;
      case 3: scores[0] += -0.009514; scores[1] += 0.006133; scores[2] += 0.003380; break;
      case 4: scores[0] += -0.011823; scores[1] += -0.006775; scores[2] += 0.018598; break;
      case 5: scores[0] += -0.005095; scores[1] += 0.013709; scores[2] += -0.008614; break;
      case 6: scores[0] += -0.005685; scores[1] += -0.005451; scores[2] += 0.011136; break;
      case 7: scores[0] += 0.003219; scores[1] += -0.008205; scores[2] += 0.004986; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.010841; scores[1] += 0.006279; scores[2] += 0.004563; break;
      case 11: scores[0] += 0.013447; scores[1] += -0.000863; scores[2] += -0.012584; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.017498; scores[1] += 0.020504; scores[2] += -0.003006; break;
      case 15: scores[0] += 0.022963; scores[1] += -0.008419; scores[2] += -0.014545; break;
    }
  }

  // Tree 316 (depth=4)
  {
    const leafIdx = ((features[13] > 0.4721362292766571) << 0) | ((features[13] > 0.4749373495578766) << 1) | ((features[43] > 0.39642858505249023) << 2) | ((features[10] > 6.366666793823242) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007766; scores[1] += -0.002847; scores[2] += -0.004918; break;
      case 1: scores[0] += -0.001090; scores[1] += -0.032074; scores[2] += 0.033165; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.003896; scores[1] += 0.005305; scores[2] += -0.009201; break;
      case 4: scores[0] += -0.000528; scores[1] += 0.018402; scores[2] += -0.017874; break;
      case 5: scores[0] += -0.000270; scores[1] += 0.001066; scores[2] += -0.000796; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000351; scores[1] += 0.000273; scores[2] += -0.000625; break;
      case 8: scores[0] += -0.001601; scores[1] += 0.000790; scores[2] += 0.000811; break;
      case 9: scores[0] += -0.000334; scores[1] += 0.007139; scores[2] += -0.006805; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000930; scores[1] += 0.000033; scores[2] += -0.000962; break;
      case 12: scores[0] += -0.002653; scores[1] += -0.003203; scores[2] += 0.005856; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.009057; scores[1] += -0.003405; scores[2] += 0.012462; break;
    }
  }

  // Tree 317 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[13] > 0.8164982795715332) << 1) | ((features[43] > 0.489130437374115) << 2) | ((features[11] > 0.07059800624847412) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005549; scores[1] += -0.000919; scores[2] += 0.006468; break;
      case 1: scores[0] += -0.012122; scores[1] += 0.007293; scores[2] += 0.004828; break;
      case 2: scores[0] += -0.000043; scores[1] += 0.004847; scores[2] += -0.004804; break;
      case 3: scores[0] += 0.002388; scores[1] += 0.016923; scores[2] += -0.019311; break;
      case 4: scores[0] += -0.002513; scores[1] += 0.010061; scores[2] += -0.007548; break;
      case 5: scores[0] += -0.001545; scores[1] += 0.010844; scores[2] += -0.009299; break;
      case 6: scores[0] += -0.003041; scores[1] += -0.001962; scores[2] += 0.005003; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.006406; scores[1] += -0.000672; scores[2] += -0.005734; break;
      case 9: scores[0] += -0.006076; scores[1] += 0.003163; scores[2] += 0.002913; break;
      case 10: scores[0] += 0.009378; scores[1] += -0.005327; scores[2] += -0.004051; break;
      case 11: scores[0] += 0.030714; scores[1] += -0.002526; scores[2] += -0.028188; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 318 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[13] > 0.7295321226119995) << 1) | ((features[11] > 0.03077651560306549) << 2) | ((features[10] > 11.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000267; scores[1] += -0.000274; scores[2] += 0.000008; break;
      case 1: scores[0] += -0.004550; scores[1] += 0.006196; scores[2] += -0.001646; break;
      case 2: scores[0] += 0.008949; scores[1] += -0.003408; scores[2] += -0.005541; break;
      case 3: scores[0] += -0.013379; scores[1] += -0.008333; scores[2] += 0.021712; break;
      case 4: scores[0] += 0.003150; scores[1] += -0.004613; scores[2] += 0.001464; break;
      case 5: scores[0] += 0.000021; scores[1] += -0.006554; scores[2] += 0.006534; break;
      case 6: scores[0] += -0.013789; scores[1] += 0.021565; scores[2] += -0.007775; break;
      case 7: scores[0] += 0.025247; scores[1] += -0.012968; scores[2] += -0.012278; break;
      case 8: scores[0] += 0.000691; scores[1] += -0.007376; scores[2] += 0.006685; break;
      case 9: scores[0] += -0.003006; scores[1] += 0.031742; scores[2] += -0.028736; break;
      case 10: scores[0] += -0.024912; scores[1] += 0.006561; scores[2] += 0.018350; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.004153; scores[1] += -0.006013; scores[2] += 0.010166; break;
      case 13: scores[0] += -0.002694; scores[1] += -0.003208; scores[2] += 0.005902; break;
      case 14: scores[0] += 0.018824; scores[1] += -0.025705; scores[2] += 0.006881; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 319 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[13] > 0.8198052048683167) << 1) | ((features[13] > 0.9148551225662231) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000660; scores[1] += -0.002020; scores[2] += 0.001360; break;
      case 1: scores[0] += -0.000206; scores[1] += 0.003113; scores[2] += -0.002907; break;
      case 2: scores[0] += 0.007731; scores[1] += 0.026697; scores[2] += -0.034428; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.002918; scores[1] += 0.000015; scores[2] += 0.002903; break;
      case 7: scores[0] += -0.000910; scores[1] += 0.004503; scores[2] += -0.003593; break;
      case 8: scores[0] += -0.012657; scores[1] += 0.008233; scores[2] += 0.004423; break;
      case 9: scores[0] += -0.000229; scores[1] += 0.016272; scores[2] += -0.016043; break;
      case 10: scores[0] += -0.001910; scores[1] += 0.006888; scores[2] += -0.004977; break;
      case 11: scores[0] += -0.002528; scores[1] += -0.011675; scores[2] += 0.014203; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.019448; scores[1] += -0.013921; scores[2] += -0.005527; break;
      case 15: scores[0] += -0.000888; scores[1] += -0.008142; scores[2] += 0.009030; break;
    }
  }

  // Tree 320 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[27] > 0.5) << 1) | ((features[10] > 6.775000095367432) << 2) | ((features[43] > 0.71875) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002293; scores[1] += 0.001415; scores[2] += 0.000877; break;
      case 1: scores[0] += -0.007747; scores[1] += 0.008961; scores[2] += -0.001215; break;
      case 2: scores[0] += -0.000823; scores[1] += -0.011395; scores[2] += 0.012218; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.001159; scores[1] += -0.000454; scores[2] += -0.000705; break;
      case 5: scores[0] += -0.001693; scores[1] += 0.014669; scores[2] += -0.012976; break;
      case 6: scores[0] += 0.004091; scores[1] += -0.007805; scores[2] += 0.003714; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.003945; scores[1] += -0.006644; scores[2] += 0.010588; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.004492; scores[1] += 0.009668; scores[2] += -0.014160; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.003926; scores[1] += 0.011009; scores[2] += -0.014936; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.013760; scores[1] += -0.012476; scores[2] += 0.026236; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 321 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[44] > 0.25) << 2) | ((features[23] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002748; scores[1] += -0.000327; scores[2] += -0.002421; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.004479; scores[1] += -0.007342; scores[2] += 0.011821; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000785; scores[1] += 0.001804; scores[2] += -0.001019; break;
      case 5: scores[0] += -0.002800; scores[1] += -0.021881; scores[2] += 0.024681; break;
      case 6: scores[0] += 0.003899; scores[1] += -0.010112; scores[2] += 0.006214; break;
      case 7: scores[0] += -0.003920; scores[1] += 0.024067; scores[2] += -0.020147; break;
      case 8: scores[0] += -0.001541; scores[1] += 0.014624; scores[2] += -0.013084; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001862; scores[1] += 0.015817; scores[2] += -0.013955; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002815; scores[1] += 0.019938; scores[2] += -0.017124; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.006336; scores[1] += 0.039241; scores[2] += -0.032905; break;
      case 15: scores[0] += -0.002279; scores[1] += 0.006437; scores[2] += -0.004158; break;
    }
  }

  // Tree 322 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[10] > 11.833333969116211) << 1) | ((features[9] > 2.5) << 2) | ((features[11] > 0.049390241503715515) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005252; scores[1] += -0.001079; scores[2] += -0.004172; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.020932; scores[1] += 0.001509; scores[2] += 0.019423; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.007633; scores[1] += 0.004657; scores[2] += 0.002976; break;
      case 5: scores[0] += 0.026874; scores[1] += -0.013156; scores[2] += -0.013718; break;
      case 6: scores[0] += -0.019312; scores[1] += -0.013594; scores[2] += 0.032906; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.008419; scores[1] += -0.003067; scores[2] += -0.005352; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.015524; scores[1] += -0.033613; scores[2] += 0.018089; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000426; scores[1] += 0.000002; scores[2] += 0.000424; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.009255; scores[1] += 0.009312; scores[2] += -0.018567; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 323 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[43] > 0.41885966062545776) << 1) | ((features[10] > 4.7083330154418945) << 2) | ((features[10] > 4.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005462; scores[1] += 0.001472; scores[2] += -0.006934; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.022524; scores[1] += 0.015013; scores[2] += 0.007511; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.002927; scores[1] += 0.007682; scores[2] += -0.004755; break;
      case 9: scores[0] += -0.001074; scores[1] += -0.032777; scores[2] += 0.033852; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.004326; scores[1] += -0.003248; scores[2] += 0.007574; break;
      case 12: scores[0] += -0.002849; scores[1] += 0.003237; scores[2] += -0.000388; break;
      case 13: scores[0] += 0.001745; scores[1] += -0.003309; scores[2] += 0.001564; break;
      case 14: scores[0] += -0.000028; scores[1] += 0.025336; scores[2] += -0.025308; break;
      case 15: scores[0] += 0.004878; scores[1] += -0.005464; scores[2] += 0.000586; break;
    }
  }

  // Tree 324 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[43] > 0.41885966062545776) << 1) | ((features[13] > 0.42206478118896484) << 2) | ((features[13] > 0.4258241653442383) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001351; scores[1] += 0.002154; scores[2] += -0.000803; break;
      case 1: scores[0] += -0.007725; scores[1] += 0.015325; scores[2] += -0.007600; break;
      case 2: scores[0] += -0.000029; scores[1] += 0.025114; scores[2] += -0.025085; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001065; scores[1] += -0.034907; scores[2] += 0.035972; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000086; scores[1] += -0.006774; scores[2] += 0.006861; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.001706; scores[1] += -0.002862; scores[2] += 0.001156; break;
      case 13: scores[0] += -0.001602; scores[1] += 0.005360; scores[2] += -0.003758; break;
      case 14: scores[0] += -0.003682; scores[1] += 0.000653; scores[2] += 0.003029; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 325 (depth=4)
  {
    const leafIdx = ((features[44] > 0.3500000238418579) << 0) | ((features[10] > 11.583333969116211) << 1) | ((features[44] > 0.44999998807907104) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002203; scores[1] += 0.001989; scores[2] += -0.004192; break;
      case 1: scores[0] += 0.010738; scores[1] += -0.020948; scores[2] += 0.010209; break;
      case 2: scores[0] += -0.005941; scores[1] += 0.005401; scores[2] += 0.000540; break;
      case 3: scores[0] += -0.010198; scores[1] += -0.023069; scores[2] += 0.033267; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.013965; scores[1] += 0.025879; scores[2] += -0.011915; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.008230; scores[1] += 0.016206; scores[2] += -0.007976; break;
      case 8: scores[0] += 0.001863; scores[1] += -0.008357; scores[2] += 0.006494; break;
      case 9: scores[0] += -0.013122; scores[1] += 0.036687; scores[2] += -0.023565; break;
      case 10: scores[0] += -0.001877; scores[1] += -0.007176; scores[2] += 0.009053; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.000674; scores[1] += 0.006313; scores[2] += -0.005640; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 326 (depth=4)
  {
    const leafIdx = ((features[43] > 0.6651785373687744) << 0) | ((features[10] > 11.833333969116211) << 1) | ((features[10] > 12.583333969116211) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000862; scores[1] += 0.001841; scores[2] += -0.000979; break;
      case 1: scores[0] += -0.016138; scores[1] += 0.011423; scores[2] += 0.004716; break;
      case 2: scores[0] += -0.004402; scores[1] += -0.028763; scores[2] += 0.033165; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.007220; scores[1] += 0.001828; scores[2] += 0.005391; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.005561; scores[1] += -0.022272; scores[2] += 0.016711; break;
      case 9: scores[0] += 0.003921; scores[1] += 0.000893; scores[2] += -0.004814; break;
      case 10: scores[0] += 0.004159; scores[1] += 0.005689; scores[2] += -0.009848; break;
      case 11: scores[0] += -0.010218; scores[1] += -0.022469; scores[2] += 0.032687; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.007287; scores[1] += 0.020909; scores[2] += -0.028196; break;
      case 15: scores[0] += -0.008050; scores[1] += 0.015808; scores[2] += -0.007758; break;
    }
  }

  // Tree 327 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[10] > 4.7083330154418945) << 1) | ((features[9] > 1.5) << 2) | ((features[10] > 10.833333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006609; scores[1] += -0.005851; scores[2] += -0.000758; break;
      case 1: scores[0] += -0.024069; scores[1] += 0.004294; scores[2] += 0.019775; break;
      case 2: scores[0] += 0.000072; scores[1] += -0.019370; scores[2] += 0.019298; break;
      case 3: scores[0] += 0.015421; scores[1] += -0.000138; scores[2] += -0.015283; break;
      case 4: scores[0] += -0.005987; scores[1] += -0.005867; scores[2] += 0.011853; break;
      case 5: scores[0] += -0.007974; scores[1] += 0.012542; scores[2] += -0.004568; break;
      case 6: scores[0] += 0.000816; scores[1] += -0.000367; scores[2] += -0.000449; break;
      case 7: scores[0] += -0.008791; scores[1] += 0.001924; scores[2] += 0.006867; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.014459; scores[1] += 0.017981; scores[2] += -0.032441; break;
      case 11: scores[0] += -0.019593; scores[1] += 0.000307; scores[2] += 0.019286; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.010676; scores[1] += 0.008998; scores[2] += 0.001677; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 328 (depth=4)
  {
    const leafIdx = ((features[47] > 0.2666666805744171) << 0) | ((features[11] > 0.03229166567325592) << 1) | ((features[7] > 0.5) << 2) | ((features[43] > 0.1026315838098526) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002214; scores[1] += 0.001475; scores[2] += -0.003689; break;
      case 1: scores[0] += -0.026764; scores[1] += 0.029202; scores[2] += -0.002438; break;
      case 2: scores[0] += 0.007365; scores[1] += -0.006144; scores[2] += -0.001221; break;
      case 3: scores[0] += 0.009490; scores[1] += -0.007879; scores[2] += -0.001612; break;
      case 4: scores[0] += 0.019375; scores[1] += -0.013480; scores[2] += -0.005894; break;
      case 5: scores[0] += 0.014296; scores[1] += -0.012399; scores[2] += -0.001896; break;
      case 6: scores[0] += 0.001613; scores[1] += -0.000485; scores[2] += -0.001128; break;
      case 7: scores[0] += 0.001361; scores[1] += -0.000602; scores[2] += -0.000759; break;
      case 8: scores[0] += -0.004505; scores[1] += -0.001974; scores[2] += 0.006479; break;
      case 9: scores[0] += -0.005970; scores[1] += 0.009734; scores[2] += -0.003764; break;
      case 10: scores[0] += -0.033324; scores[1] += 0.018317; scores[2] += 0.015007; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 329 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[13] > 0.02817460335791111) << 1) | ((features[14] > 0.5) << 2) | ((features[10] > 12.583333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005083; scores[1] += 0.003977; scores[2] += 0.001106; break;
      case 1: scores[0] += -0.003277; scores[1] += -0.019323; scores[2] += 0.022600; break;
      case 2: scores[0] += 0.013767; scores[1] += -0.018257; scores[2] += 0.004490; break;
      case 3: scores[0] += -0.004865; scores[1] += 0.032802; scores[2] += -0.027937; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001520; scores[1] += 0.001997; scores[2] += -0.000477; break;
      case 7: scores[0] += -0.000232; scores[1] += 0.002482; scores[2] += -0.002250; break;
      case 8: scores[0] += 0.012830; scores[1] += -0.012546; scores[2] += -0.000284; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.033345; scores[1] += 0.029207; scores[2] += 0.004138; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.016197; scores[1] += -0.004702; scores[2] += -0.011494; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 330 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5285947918891907) << 0) | ((features[10] > 9.708333969116211) << 1) | ((features[10] > 10.583333969116211) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002735; scores[1] += -0.000899; scores[2] += -0.001836; break;
      case 1: scores[0] += 0.005989; scores[1] += 0.002736; scores[2] += -0.008725; break;
      case 2: scores[0] += -0.002485; scores[1] += -0.003455; scores[2] += 0.005940; break;
      case 3: scores[0] += 0.006868; scores[1] += -0.011701; scores[2] += 0.004834; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.004218; scores[1] += -0.000362; scores[2] += 0.004579; break;
      case 7: scores[0] += -0.001089; scores[1] += 0.021360; scores[2] += -0.020271; break;
      case 8: scores[0] += -0.006869; scores[1] += -0.000870; scores[2] += 0.007739; break;
      case 9: scores[0] += -0.004580; scores[1] += 0.005221; scores[2] += -0.000641; break;
      case 10: scores[0] += -0.020187; scores[1] += 0.002839; scores[2] += 0.017348; break;
      case 11: scores[0] += 0.030320; scores[1] += -0.034113; scores[2] += 0.003792; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.013155; scores[1] += -0.011321; scores[2] += -0.001834; break;
      case 15: scores[0] += 0.005159; scores[1] += -0.002706; scores[2] += -0.002453; break;
    }
  }

  // Tree 331 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.633333206176758) << 1) | ((features[27] > 0.5) << 2) | ((features[10] > 6.550000190734863) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004538; scores[1] += -0.000239; scores[2] += -0.004299; break;
      case 1: scores[0] += -0.002186; scores[1] += -0.006098; scores[2] += 0.008284; break;
      case 2: scores[0] += -0.004377; scores[1] += 0.002544; scores[2] += 0.001833; break;
      case 3: scores[0] += -0.004882; scores[1] += 0.007691; scores[2] += -0.002809; break;
      case 4: scores[0] += -0.003346; scores[1] += 0.012219; scores[2] += -0.008873; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.008263; scores[1] += -0.015367; scores[2] += 0.007105; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000162; scores[1] += -0.000226; scores[2] += 0.000064; break;
      case 11: scores[0] += -0.002108; scores[1] += 0.019114; scores[2] += -0.017006; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.009643; scores[1] += -0.017543; scores[2] += 0.027186; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 332 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[13] > 0.9384469985961914) << 1) | ((features[13] > 0.9354166984558105) << 2) | ((features[9] > 2.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000456; scores[1] += 0.000755; scores[2] += -0.000299; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001159; scores[1] += -0.003442; scores[2] += 0.004601; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.002364; scores[1] += 0.001236; scores[2] += 0.001128; break;
      case 9: scores[0] += 0.025756; scores[1] += -0.012571; scores[2] += -0.013185; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.033093; scores[1] += -0.031532; scores[2] += -0.001561; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.011618; scores[1] += 0.012754; scores[2] += -0.001136; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 333 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9384469985961914) << 0) | ((features[11] > 0.06155303120613098) << 1) | ((features[11] > 0.05971479415893555) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004598; scores[1] += -0.002003; scores[2] += -0.002595; break;
      case 1: scores[0] += -0.007771; scores[1] += 0.000983; scores[2] += 0.006788; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.006065; scores[1] += -0.015735; scores[2] += 0.021800; break;
      case 5: scores[0] += -0.038141; scores[1] += 0.044414; scores[2] += -0.006273; break;
      case 6: scores[0] += 0.000857; scores[1] += -0.005753; scores[2] += 0.004896; break;
      case 7: scores[0] += 0.031695; scores[1] += -0.029126; scores[2] += -0.002569; break;
      case 8: scores[0] += 0.000511; scores[1] += 0.004127; scores[2] += -0.004638; break;
      case 9: scores[0] += 0.023679; scores[1] += -0.004515; scores[2] += -0.019164; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.004549; scores[1] += 0.002919; scores[2] += 0.001630; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.007878; scores[1] += 0.002416; scores[2] += -0.010294; break;
      case 15: scores[0] += -0.018761; scores[1] += -0.006407; scores[2] += 0.025168; break;
    }
  }

  // Tree 334 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 8.100000381469727) << 1) | ((features[11] > 0.026671409606933594) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008650; scores[1] += -0.011192; scores[2] += 0.002541; break;
      case 1: scores[0] += 0.029640; scores[1] += -0.006919; scores[2] += -0.022720; break;
      case 2: scores[0] += -0.004138; scores[1] += 0.011722; scores[2] += -0.007585; break;
      case 3: scores[0] += -0.003345; scores[1] += -0.011182; scores[2] += 0.014527; break;
      case 4: scores[0] += -0.003160; scores[1] += 0.005069; scores[2] += -0.001909; break;
      case 5: scores[0] += -0.016232; scores[1] += 0.000619; scores[2] += 0.015613; break;
      case 6: scores[0] += 0.002781; scores[1] += -0.010061; scores[2] += 0.007280; break;
      case 7: scores[0] += -0.004377; scores[1] += -0.011239; scores[2] += 0.015616; break;
      case 8: scores[0] += -0.005625; scores[1] += 0.003202; scores[2] += 0.002423; break;
      case 9: scores[0] += -0.002892; scores[1] += -0.011880; scores[2] += 0.014772; break;
      case 10: scores[0] += 0.011274; scores[1] += -0.000629; scores[2] += -0.010645; break;
      case 11: scores[0] += -0.000649; scores[1] += 0.001471; scores[2] += -0.000822; break;
      case 12: scores[0] += -0.004806; scores[1] += 0.006820; scores[2] += -0.002014; break;
      case 13: scores[0] += -0.007541; scores[1] += 0.024286; scores[2] += -0.016745; break;
      case 14: scores[0] += 0.007795; scores[1] += -0.006544; scores[2] += -0.001251; break;
      case 15: scores[0] += -0.007762; scores[1] += -0.012555; scores[2] += 0.020317; break;
    }
  }

  // Tree 335 (depth=4)
  {
    const leafIdx = ((features[43] > 0.15894736349582672) << 0) | ((features[43] > 0.17028985917568207) << 1) | ((features[2] > 0.5) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003572; scores[1] += -0.003089; scores[2] += -0.000483; break;
      case 1: scores[0] += -0.004915; scores[1] += -0.021683; scores[2] += 0.026598; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.007307; scores[1] += 0.022522; scores[2] += -0.015215; break;
      case 4: scores[0] += -0.011810; scores[1] += 0.013587; scores[2] += -0.001777; break;
      case 5: scores[0] += -0.000974; scores[1] += 0.005243; scores[2] += -0.004269; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.003978; scores[1] += 0.007041; scores[2] += -0.003063; break;
      case 8: scores[0] += 0.006655; scores[1] += 0.017359; scores[2] += -0.024015; break;
      case 9: scores[0] += -0.018620; scores[1] += 0.003286; scores[2] += 0.015334; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.005996; scores[1] += -0.009777; scores[2] += 0.015774; break;
      case 12: scores[0] += 0.027286; scores[1] += -0.045313; scores[2] += 0.018027; break;
      case 13: scores[0] += -0.009865; scores[1] += -0.002363; scores[2] += 0.012228; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.012097; scores[1] += -0.009540; scores[2] += 0.021637; break;
    }
  }

  // Tree 336 (depth=4)
  {
    const leafIdx = ((features[10] > 4.099999904632568) << 0) | ((features[44] > 0.25) << 1) | ((features[43] > 0.9285714626312256) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006404; scores[1] += -0.005667; scores[2] += -0.000738; break;
      case 1: scores[0] += 0.000528; scores[1] += -0.000889; scores[2] += 0.000361; break;
      case 2: scores[0] += -0.000831; scores[1] += 0.007480; scores[2] += -0.006649; break;
      case 3: scores[0] += -0.002168; scores[1] += 0.000864; scores[2] += 0.001304; break;
      case 4: scores[0] += -0.021955; scores[1] += 0.004406; scores[2] += 0.017549; break;
      case 5: scores[0] += 0.017707; scores[1] += -0.011988; scores[2] += -0.005719; break;
      case 6: scores[0] += -0.001745; scores[1] += 0.010954; scores[2] += -0.009209; break;
      case 7: scores[0] += -0.009260; scores[1] += 0.018945; scores[2] += -0.009685; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000776; scores[1] += 0.002617; scores[2] += -0.001841; break;
      case 11: scores[0] += 0.002302; scores[1] += -0.000306; scores[2] += -0.001996; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002712; scores[1] += 0.010896; scores[2] += -0.008184; break;
      case 15: scores[0] += -0.001181; scores[1] += -0.010273; scores[2] += 0.011455; break;
    }
  }

  // Tree 337 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[43] > 0.19615384936332703) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001883; scores[1] += -0.000120; scores[2] += -0.001763; break;
      case 1: scores[0] += -0.008426; scores[1] += 0.014738; scores[2] += -0.006313; break;
      case 2: scores[0] += -0.000087; scores[1] += 0.000530; scores[2] += -0.000443; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003067; scores[1] += -0.004160; scores[2] += 0.007227; break;
      case 7: scores[0] += -0.000142; scores[1] += 0.001513; scores[2] += -0.001372; break;
      case 8: scores[0] += 0.001283; scores[1] += 0.006158; scores[2] += -0.007441; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.005288; scores[1] += -0.009896; scores[2] += 0.015184; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.009708; scores[1] += -0.001730; scores[2] += 0.011438; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 338 (depth=4)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[11] > 0.07229965180158615) << 1) | ((features[2] > 0.5) << 2) | ((features[11] > 0.033908046782016754) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001772; scores[1] += 0.000659; scores[2] += 0.001113; break;
      case 1: scores[0] += 0.006103; scores[1] += -0.000322; scores[2] += -0.005781; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001145; scores[1] += 0.026065; scores[2] += -0.024920; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.006443; scores[1] += -0.009224; scores[2] += 0.002781; break;
      case 9: scores[0] += -0.014826; scores[1] += 0.024199; scores[2] += -0.009373; break;
      case 10: scores[0] += 0.021923; scores[1] += 0.003253; scores[2] += -0.025176; break;
      case 11: scores[0] += 0.004381; scores[1] += -0.008841; scores[2] += 0.004460; break;
      case 12: scores[0] += 0.014584; scores[1] += -0.035199; scores[2] += 0.020616; break;
      case 13: scores[0] += 0.015691; scores[1] += -0.022213; scores[2] += 0.006522; break;
      case 14: scores[0] += -0.008610; scores[1] += 0.009259; scores[2] += -0.000649; break;
      case 15: scores[0] += -0.000154; scores[1] += -0.020084; scores[2] += 0.020238; break;
    }
  }

  // Tree 339 (depth=4)
  {
    const leafIdx = ((features[3] > 0.5) << 0) | ((features[0] > 0.5) << 1) | ((features[10] > 6.224999904632568) << 2) | ((features[11] > 0.13714733719825745) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003476; scores[1] += 0.003309; scores[2] += 0.000167; break;
      case 1: scores[0] += -0.001282; scores[1] += 0.006410; scores[2] += -0.005128; break;
      case 2: scores[0] += -0.004813; scores[1] += -0.011078; scores[2] += 0.015891; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001123; scores[1] += 0.000706; scores[2] += 0.000417; break;
      case 5: scores[0] += -0.014337; scores[1] += 0.041085; scores[2] += -0.026748; break;
      case 6: scores[0] += 0.008079; scores[1] += -0.011859; scores[2] += 0.003781; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += -0.009017; scores[1] += 0.006439; scores[2] += 0.002578; break;
      case 10: scores[0] += 0.026402; scores[1] += -0.011577; scores[2] += -0.014825; break;
      case 11: scores[0] += -0.002659; scores[1] += -0.012911; scores[2] += 0.015570; break;
      case 12: scores[0] += -0.005234; scores[1] += -0.038044; scores[2] += 0.043278; break;
      case 13: scores[0] += 0.006279; scores[1] += -0.001114; scores[2] += -0.005165; break;
      case 14: scores[0] += 0.015469; scores[1] += 0.016282; scores[2] += -0.031751; break;
      case 15: scores[0] += -0.005790; scores[1] += -0.015249; scores[2] += 0.021039; break;
    }
  }

  // Tree 340 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[30] > 0.5) << 2) | ((features[11] > 0.06155303120613098) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001287; scores[1] += -0.000788; scores[2] += 0.002074; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.005622; scores[1] += 0.017866; scores[2] += -0.012244; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.006900; scores[1] += 0.023936; scores[2] += -0.017036; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.009157; scores[1] += -0.032263; scores[2] += 0.023106; break;
      case 7: scores[0] += -0.000002; scores[1] += 0.001952; scores[2] += -0.001950; break;
      case 8: scores[0] += 0.000375; scores[1] += 0.002855; scores[2] += -0.003230; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001200; scores[1] += 0.003981; scores[2] += -0.002782; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.023904; scores[1] += -0.038921; scores[2] += 0.015017; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.023561; scores[1] += 0.022934; scores[2] += 0.000627; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 341 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9183333516120911) << 0) | ((features[13] > 0.9384469985961914) << 1) | ((features[43] > 0.21807065606117249) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000476; scores[1] += -0.002539; scores[2] += 0.002064; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.011793; scores[1] += 0.008626; scores[2] += -0.020419; break;
      case 4: scores[0] += -0.005524; scores[1] += 0.014922; scores[2] += -0.009398; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.002201; scores[1] += -0.012453; scores[2] += 0.014654; break;
      case 8: scores[0] += 0.000342; scores[1] += 0.001340; scores[2] += -0.001683; break;
      case 9: scores[0] += 0.028490; scores[1] += -0.046741; scores[2] += 0.018251; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.012804; scores[1] += 0.019945; scores[2] += -0.007140; break;
      case 12: scores[0] += -0.022781; scores[1] += 0.005166; scores[2] += 0.017615; break;
      case 13: scores[0] += -0.005922; scores[1] += 0.028229; scores[2] += -0.022308; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.003221; scores[1] += 0.001501; scores[2] += 0.001721; break;
    }
  }

  // Tree 342 (depth=4)
  {
    const leafIdx = ((features[9] > 2.5) << 0) | ((features[10] > 11.291666030883789) << 1) | ((features[13] > 0.1026315838098526) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004651; scores[1] += -0.012729; scores[2] += 0.008079; break;
      case 1: scores[0] += -0.018273; scores[1] += 0.026716; scores[2] += -0.008442; break;
      case 2: scores[0] += 0.015305; scores[1] += 0.007877; scores[2] += -0.023181; break;
      case 3: scores[0] += -0.000195; scores[1] += -0.028704; scores[2] += 0.028899; break;
      case 4: scores[0] += 0.016952; scores[1] += 0.017381; scores[2] += -0.034333; break;
      case 5: scores[0] += 0.009833; scores[1] += -0.027657; scores[2] += 0.017825; break;
      case 6: scores[0] += -0.023660; scores[1] += 0.001048; scores[2] += 0.022612; break;
      case 7: scores[0] += -0.009705; scores[1] += 0.023377; scores[2] += -0.013672; break;
      case 8: scores[0] += 0.003843; scores[1] += -0.000469; scores[2] += -0.003373; break;
      case 9: scores[0] += -0.005959; scores[1] += -0.000652; scores[2] += 0.006611; break;
      case 10: scores[0] += 0.001343; scores[1] += -0.002447; scores[2] += 0.001103; break;
      case 11: scores[0] += -0.009490; scores[1] += -0.018990; scores[2] += 0.028480; break;
      case 12: scores[0] += 0.002434; scores[1] += 0.001978; scores[2] += -0.004412; break;
      case 13: scores[0] += 0.000944; scores[1] += 0.000961; scores[2] += -0.001905; break;
      case 14: scores[0] += 0.004826; scores[1] += -0.015939; scores[2] += 0.011112; break;
      case 15: scores[0] += 0.010380; scores[1] += 0.005200; scores[2] += -0.015580; break;
    }
  }

  // Tree 343 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[10] > 8.225000381469727) << 1) | ((features[4] > 0.5) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.007394; scores[1] += 0.004942; scores[2] += 0.002453; break;
      case 1: scores[0] += 0.023743; scores[1] += -0.011194; scores[2] += -0.012549; break;
      case 2: scores[0] += -0.002693; scores[1] += 0.000059; scores[2] += 0.002633; break;
      case 3: scores[0] += 0.002058; scores[1] += -0.001224; scores[2] += -0.000834; break;
      case 4: scores[0] += -0.006642; scores[1] += -0.007035; scores[2] += 0.013677; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.018036; scores[1] += 0.011106; scores[2] += -0.029142; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.016491; scores[1] += 0.005219; scores[2] += 0.011273; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.003000; scores[1] += 0.005451; scores[2] += -0.002452; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.016126; scores[1] += -0.008454; scores[2] += -0.007671; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.009778; scores[1] += -0.010603; scores[2] += 0.020380; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 344 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8321678638458252) << 0) | ((features[10] > 9.291666030883789) << 1) | ((features[10] > 10.416666030883789) << 2) | ((features[34] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.010074; scores[1] += 0.004632; scores[2] += 0.005442; break;
      case 1: scores[0] += -0.003498; scores[1] += 0.002289; scores[2] += 0.001209; break;
      case 2: scores[0] += 0.017098; scores[1] += -0.011699; scores[2] += -0.005399; break;
      case 3: scores[0] += 0.028148; scores[1] += -0.015603; scores[2] += -0.012545; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.002946; scores[1] += 0.001286; scores[2] += -0.004232; break;
      case 7: scores[0] += -0.019690; scores[1] += 0.001504; scores[2] += 0.018186; break;
      case 8: scores[0] += 0.013259; scores[1] += -0.008037; scores[2] += -0.005222; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.003464; scores[1] += -0.017045; scores[2] += 0.013581; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.022193; scores[1] += 0.033801; scores[2] += -0.011609; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 345 (depth=4)
  {
    const leafIdx = ((features[11] > 0.03077651560306549) << 0) | ((features[11] > 0.039230771362781525) << 1) | ((features[40] > 0.5) << 2) | ((features[10] > 8.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000820; scores[1] += -0.002624; scores[2] += 0.001804; break;
      case 1: scores[0] += -0.000029; scores[1] += 0.000791; scores[2] += -0.000762; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.014370; scores[1] += 0.007271; scores[2] += 0.007099; break;
      case 4: scores[0] += -0.018304; scores[1] += 0.006519; scores[2] += 0.011784; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.003524; scores[1] += 0.010278; scores[2] += -0.013801; break;
      case 8: scores[0] += 0.003763; scores[1] += 0.002457; scores[2] += -0.006220; break;
      case 9: scores[0] += -0.004619; scores[1] += 0.028551; scores[2] += -0.023933; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.015804; scores[1] += -0.014539; scores[2] += -0.001265; break;
      case 12: scores[0] += 0.001293; scores[1] += 0.012541; scores[2] += -0.013833; break;
      case 13: scores[0] += -0.006450; scores[1] += -0.026340; scores[2] += 0.032790; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.003096; scores[1] += -0.005799; scores[2] += 0.008895; break;
    }
  }

  // Tree 346 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[13] > 0.2198067605495453) << 1) | ((features[43] > 0.1913919448852539) << 2) | ((features[43] > 0.20416666567325592) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000324; scores[1] += 0.002626; scores[2] += -0.002950; break;
      case 1: scores[0] += -0.018433; scores[1] += -0.004354; scores[2] += 0.022786; break;
      case 2: scores[0] += 0.002507; scores[1] += 0.000841; scores[2] += -0.003348; break;
      case 3: scores[0] += 0.008364; scores[1] += -0.004450; scores[2] += -0.003913; break;
      case 4: scores[0] += -0.002148; scores[1] += 0.007508; scores[2] += -0.005360; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.015001; scores[1] += -0.046875; scores[2] += 0.031874; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.001184; scores[1] += -0.019952; scores[2] += 0.018768; break;
      case 13: scores[0] += -0.000614; scores[1] += -0.029221; scores[2] += 0.029836; break;
      case 14: scores[0] += -0.005637; scores[1] += 0.001695; scores[2] += 0.003942; break;
      case 15: scores[0] += -0.001188; scores[1] += 0.016703; scores[2] += -0.015514; break;
    }
  }

  // Tree 347 (depth=4)
  {
    const leafIdx = ((features[43] > 0.15894736349582672) << 0) | ((features[43] > 0.3603896200656891) << 1) | ((features[9] > 1.5) << 2) | ((features[10] > 11.583333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005011; scores[1] += -0.021467; scores[2] += 0.016456; break;
      case 1: scores[0] += -0.006096; scores[1] += -0.007971; scores[2] += 0.014067; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.006175; scores[1] += 0.002985; scores[2] += -0.009160; break;
      case 4: scores[0] += 0.001940; scores[1] += 0.000617; scores[2] += -0.002557; break;
      case 5: scores[0] += -0.006570; scores[1] += -0.002665; scores[2] += 0.009234; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.018005; scores[1] += 0.016814; scores[2] += 0.001191; break;
      case 8: scores[0] += 0.009122; scores[1] += 0.014598; scores[2] += -0.023720; break;
      case 9: scores[0] += -0.000192; scores[1] += 0.007264; scores[2] += -0.007072; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.018137; scores[1] += 0.000626; scores[2] += 0.017511; break;
      case 12: scores[0] += -0.005808; scores[1] += 0.005181; scores[2] += 0.000627; break;
      case 13: scores[0] += -0.017238; scores[1] += -0.038222; scores[2] += 0.055460; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.000059; scores[1] += 0.002635; scores[2] += -0.002575; break;
    }
  }

  // Tree 348 (depth=4)
  {
    const leafIdx = ((features[11] > 0.06155303120613098) << 0) | ((features[33] > 0.5) << 1) | ((features[11] > 0.05334281921386719) << 2) | ((features[13] > 0.9298029541969299) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001270; scores[1] += 0.000023; scores[2] += 0.001247; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.008554; scores[1] += 0.009979; scores[2] += -0.001425; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.009305; scores[1] += -0.002121; scores[2] += 0.011426; break;
      case 5: scores[0] += 0.006095; scores[1] += -0.002751; scores[2] += -0.003344; break;
      case 6: scores[0] += 0.001303; scores[1] += 0.001404; scores[2] += -0.002707; break;
      case 7: scores[0] += -0.010284; scores[1] += 0.000308; scores[2] += 0.009976; break;
      case 8: scores[0] += 0.003059; scores[1] += 0.005640; scores[2] += -0.008699; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.014092; scores[1] += -0.018462; scores[2] += 0.004370; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.012233; scores[1] += -0.006099; scores[2] += -0.006134; break;
      case 13: scores[0] += -0.006462; scores[1] += -0.017275; scores[2] += 0.023737; break;
      case 14: scores[0] += -0.041377; scores[1] += 0.051491; scores[2] += -0.010114; break;
      case 15: scores[0] += 0.029659; scores[1] += -0.026683; scores[2] += -0.002976; break;
    }
  }

  // Tree 349 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 5.775000095367432) << 1) | ((features[10] > 5.7083330154418945) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001736; scores[1] += -0.000063; scores[2] += -0.001673; break;
      case 1: scores[0] += 0.015084; scores[1] += 0.003041; scores[2] += -0.018125; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001276; scores[1] += 0.005923; scores[2] += -0.004646; break;
      case 5: scores[0] += -0.000611; scores[1] += -0.028536; scores[2] += 0.029148; break;
      case 6: scores[0] += 0.002420; scores[1] += -0.000309; scores[2] += -0.002110; break;
      case 7: scores[0] += -0.004761; scores[1] += -0.005362; scores[2] += 0.010123; break;
      case 8: scores[0] += -0.003709; scores[1] += -0.003739; scores[2] += 0.007448; break;
      case 9: scores[0] += -0.002460; scores[1] += -0.014041; scores[2] += 0.016502; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001367; scores[1] += 0.008166; scores[2] += -0.006798; break;
      case 13: scores[0] += -0.000020; scores[1] += 0.000407; scores[2] += -0.000387; break;
      case 14: scores[0] += -0.004078; scores[1] += 0.002349; scores[2] += 0.001729; break;
      case 15: scores[0] += -0.016875; scores[1] += 0.009955; scores[2] += 0.006920; break;
    }
  }

  // Tree 350 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[9] > 2.5) << 1) | ((features[44] > 0.25) << 2) | ((features[13] > 0.9743589758872986) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001069; scores[1] += 0.000024; scores[2] += 0.001045; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000685; scores[1] += 0.002129; scores[2] += -0.001444; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.003544; scores[1] += -0.001873; scores[2] += -0.001671; break;
      case 7: scores[0] += -0.000777; scores[1] += -0.013580; scores[2] += 0.014357; break;
      case 8: scores[0] += -0.000074; scores[1] += -0.005849; scores[2] += 0.005923; break;
      case 9: scores[0] += 0.005856; scores[1] += 0.001785; scores[2] += -0.007641; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000697; scores[1] += 0.008897; scores[2] += -0.008200; break;
      case 13: scores[0] += -0.013101; scores[1] += -0.012250; scores[2] += 0.025352; break;
      case 14: scores[0] += -0.010947; scores[1] += 0.010319; scores[2] += 0.000628; break;
      case 15: scores[0] += 0.001476; scores[1] += 0.007589; scores[2] += -0.009065; break;
    }
  }

  // Tree 351 (depth=4)
  {
    const leafIdx = ((features[7] > 0.5) << 0) | ((features[11] > 0.03077651560306549) << 1) | ((features[11] > 0.035098522901535034) << 2) | ((features[13] > 0.09545454382896423) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005255; scores[1] += 0.006992; scores[2] += -0.001736; break;
      case 1: scores[0] += 0.026822; scores[1] += -0.020076; scores[2] += -0.006746; break;
      case 2: scores[0] += -0.001954; scores[1] += -0.032492; scores[2] += 0.034446; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.011653; scores[1] += 0.014256; scores[2] += -0.002603; break;
      case 7: scores[0] += 0.002512; scores[1] += -0.000950; scores[2] += -0.001561; break;
      case 8: scores[0] += -0.002383; scores[1] += -0.000356; scores[2] += 0.002739; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.006723; scores[1] += 0.022457; scores[2] += -0.015734; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.004749; scores[1] += -0.008831; scores[2] += 0.004082; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 352 (depth=4)
  {
    const leafIdx = ((features[5] > 0.5) << 0) | ((features[11] > 0.07059800624847412) << 1) | ((features[13] > 0.42206478118896484) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.012068; scores[1] += 0.005386; scores[2] += 0.006682; break;
      case 1: scores[0] += 0.020066; scores[1] += -0.015096; scores[2] += -0.004969; break;
      case 2: scores[0] += -0.003646; scores[1] += 0.005532; scores[2] += -0.001887; break;
      case 3: scores[0] += 0.001159; scores[1] += -0.000366; scores[2] += -0.000793; break;
      case 4: scores[0] += 0.005209; scores[1] += -0.000713; scores[2] += -0.004496; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.002211; scores[1] += -0.002145; scores[2] += 0.004356; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.003424; scores[1] += 0.007092; scores[2] += -0.003668; break;
      case 9: scores[0] += 0.009668; scores[1] += -0.007438; scores[2] += -0.002230; break;
      case 10: scores[0] += -0.001989; scores[1] += -0.000648; scores[2] += 0.002637; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.033234; scores[1] += 0.004062; scores[2] += 0.029172; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.030335; scores[1] += -0.001430; scores[2] += -0.028906; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 353 (depth=4)
  {
    const leafIdx = ((features[33] > 0.5) << 0) | ((features[11] > 0.06155303120613098) << 1) | ((features[10] > 13.25) << 2) | ((features[11] > 0.07549858093261719) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001707; scores[1] += -0.001855; scores[2] += 0.000148; break;
      case 1: scores[0] += -0.007281; scores[1] += 0.008954; scores[2] += -0.001673; break;
      case 2: scores[0] += 0.010269; scores[1] += -0.029198; scores[2] += 0.018929; break;
      case 3: scores[0] += 0.027115; scores[1] += -0.015185; scores[2] += -0.011930; break;
      case 4: scores[0] += -0.005401; scores[1] += 0.023903; scores[2] += -0.018502; break;
      case 5: scores[0] += -0.018762; scores[1] += -0.010876; scores[2] += 0.029638; break;
      case 6: scores[0] += -0.004846; scores[1] += 0.003404; scores[2] += 0.001441; break;
      case 7: scores[0] += 0.008949; scores[1] += -0.003908; scores[2] += -0.005041; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.002966; scores[1] += 0.008294; scores[2] += -0.011261; break;
      case 11: scores[0] += -0.011575; scores[1] += -0.005154; scores[2] += 0.016730; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.004833; scores[1] += -0.011907; scores[2] += 0.007074; break;
      case 15: scores[0] += 0.008045; scores[1] += -0.008094; scores[2] += 0.000049; break;
    }
  }

  // Tree 354 (depth=4)
  {
    const leafIdx = ((features[13] > 0.09545454382896423) << 0) | ((features[10] > 9.125) << 1) | ((features[35] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002347; scores[1] += 0.033201; scores[2] += -0.035548; break;
      case 1: scores[0] += -0.015812; scores[1] += -0.009681; scores[2] += 0.025493; break;
      case 2: scores[0] += 0.011575; scores[1] += -0.011698; scores[2] += 0.000124; break;
      case 3: scores[0] += -0.005386; scores[1] += 0.004928; scores[2] += 0.000458; break;
      case 4: scores[0] += -0.003129; scores[1] += -0.006282; scores[2] += 0.009411; break;
      case 5: scores[0] += -0.004458; scores[1] += -0.021392; scores[2] += 0.025850; break;
      case 6: scores[0] += -0.005127; scores[1] += -0.003569; scores[2] += 0.008696; break;
      case 7: scores[0] += 0.024051; scores[1] += 0.020902; scores[2] += -0.044952; break;
      case 8: scores[0] += 0.005549; scores[1] += -0.022189; scores[2] += 0.016640; break;
      case 9: scores[0] += -0.000737; scores[1] += -0.000602; scores[2] += 0.001340; break;
      case 10: scores[0] += -0.008462; scores[1] += 0.003702; scores[2] += 0.004759; break;
      case 11: scores[0] += 0.010578; scores[1] += -0.006911; scores[2] += -0.003668; break;
      case 12: scores[0] += -0.004650; scores[1] += 0.017286; scores[2] += -0.012637; break;
      case 13: scores[0] += -0.011894; scores[1] += 0.022187; scores[2] += -0.010292; break;
      case 14: scores[0] += -0.003169; scores[1] += -0.000639; scores[2] += 0.003808; break;
      case 15: scores[0] += -0.004839; scores[1] += 0.015732; scores[2] += -0.010893; break;
    }
  }

  // Tree 355 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 6.775000095367432) << 1) | ((features[9] > 1.5) << 2) | ((features[10] > 4.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.017518; scores[1] += 0.003184; scores[2] += 0.014334; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.009898; scores[1] += 0.000729; scores[2] += 0.009169; break;
      case 5: scores[0] += -0.002525; scores[1] += 0.009749; scores[2] += -0.007223; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.010696; scores[1] += -0.005482; scores[2] += -0.005214; break;
      case 9: scores[0] += 0.005625; scores[1] += 0.001929; scores[2] += -0.007555; break;
      case 10: scores[0] += 0.007483; scores[1] += 0.002345; scores[2] += -0.009829; break;
      case 11: scores[0] += -0.012940; scores[1] += -0.012029; scores[2] += 0.024969; break;
      case 12: scores[0] += -0.001631; scores[1] += 0.001884; scores[2] += -0.000254; break;
      case 13: scores[0] += -0.000639; scores[1] += -0.010172; scores[2] += 0.010811; break;
      case 14: scores[0] += -0.002747; scores[1] += 0.001555; scores[2] += 0.001192; break;
      case 15: scores[0] += 0.003941; scores[1] += -0.006798; scores[2] += 0.002857; break;
    }
  }

  // Tree 356 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 11.125) << 2) | ((features[10] > 10.583333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002640; scores[1] += 0.000819; scores[2] += 0.001821; break;
      case 1: scores[0] += 0.022168; scores[1] += -0.010280; scores[2] += -0.011889; break;
      case 2: scores[0] += 0.010540; scores[1] += -0.008585; scores[2] += -0.001955; break;
      case 3: scores[0] += 0.004498; scores[1] += -0.002387; scores[2] += -0.002111; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.011676; scores[1] += -0.000690; scores[2] += -0.010985; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.009525; scores[1] += 0.041426; scores[2] += -0.031900; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002343; scores[1] += -0.001856; scores[2] += 0.004200; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.015593; scores[1] += 0.001303; scores[2] += 0.014290; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 357 (depth=4)
  {
    const leafIdx = ((features[10] > 10.416666030883789) << 0) | ((features[10] > 9.875) << 1) | ((features[35] > 0.5) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003449; scores[1] += 0.003649; scores[2] += -0.007098; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.016234; scores[1] += -0.013853; scores[2] += -0.002381; break;
      case 3: scores[0] += 0.001878; scores[1] += 0.000242; scores[2] += -0.002120; break;
      case 4: scores[0] += -0.029860; scores[1] += -0.000789; scores[2] += 0.030649; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001489; scores[1] += -0.012382; scores[2] += 0.013871; break;
      case 7: scores[0] += -0.001467; scores[1] += 0.023095; scores[2] += -0.021628; break;
      case 8: scores[0] += -0.005860; scores[1] += -0.003055; scores[2] += 0.008915; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.003060; scores[1] += -0.021637; scores[2] += 0.024696; break;
      case 11: scores[0] += -0.008801; scores[1] += 0.005656; scores[2] += 0.003145; break;
      case 12: scores[0] += 0.022050; scores[1] += 0.005793; scores[2] += -0.027843; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003047; scores[1] += -0.011937; scores[2] += 0.014984; break;
      case 15: scores[0] += -0.003534; scores[1] += 0.003526; scores[2] += 0.000008; break;
    }
  }

  // Tree 358 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[10] > 7.099999904632568) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005212; scores[1] += 0.009802; scores[2] += -0.004591; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.004835; scores[1] += -0.007166; scores[2] += 0.012002; break;
      case 3: scores[0] += -0.010806; scores[1] += 0.020726; scores[2] += -0.009920; break;
      case 4: scores[0] += -0.000353; scores[1] += -0.000493; scores[2] += 0.000845; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000897; scores[1] += -0.004563; scores[2] += 0.005459; break;
      case 7: scores[0] += -0.001371; scores[1] += -0.013735; scores[2] += 0.015106; break;
      case 8: scores[0] += 0.006080; scores[1] += 0.002727; scores[2] += -0.008808; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002883; scores[1] += -0.016543; scores[2] += 0.019426; break;
      case 11: scores[0] += 0.003918; scores[1] += -0.007297; scores[2] += 0.003379; break;
      case 12: scores[0] += 0.003439; scores[1] += -0.003742; scores[2] += 0.000302; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.004429; scores[1] += 0.019182; scores[2] += -0.014753; break;
      case 15: scores[0] += -0.010744; scores[1] += 0.013834; scores[2] += -0.003090; break;
    }
  }

  // Tree 359 (depth=4)
  {
    const leafIdx = ((features[43] > 0.1889880895614624) << 0) | ((features[13] > 0.9384469985961914) << 1) | ((features[13] > 0.9298029541969299) << 2) | ((features[10] > 7.099999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008224; scores[1] += 0.001552; scores[2] += -0.009775; break;
      case 1: scores[0] += -0.004275; scores[1] += -0.011065; scores[2] += 0.015340; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.018003; scores[1] += 0.025546; scores[2] += -0.007543; break;
      case 7: scores[0] += 0.004804; scores[1] += 0.005057; scores[2] += -0.009861; break;
      case 8: scores[0] += -0.001686; scores[1] += -0.000940; scores[2] += 0.002626; break;
      case 9: scores[0] += -0.010832; scores[1] += 0.027538; scores[2] += -0.016706; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.045910; scores[1] += -0.040555; scores[2] += -0.005355; break;
      case 13: scores[0] += -0.000772; scores[1] += 0.009446; scores[2] += -0.008674; break;
      case 14: scores[0] += 0.006241; scores[1] += 0.012697; scores[2] += -0.018938; break;
      case 15: scores[0] += -0.010451; scores[1] += -0.018080; scores[2] += 0.028531; break;
    }
  }

  // Tree 360 (depth=4)
  {
    const leafIdx = ((features[13] > 0.6191683411598206) << 0) | ((features[13] > 0.6251596212387085) << 1) | ((features[10] > 9.291666030883789) << 2) | ((features[9] > 1.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005589; scores[1] += -0.034621; scores[2] += 0.029032; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.003866; scores[1] += 0.005993; scores[2] += -0.002128; break;
      case 4: scores[0] += 0.020901; scores[1] += 0.007073; scores[2] += -0.027974; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.002857; scores[1] += -0.001282; scores[2] += -0.001575; break;
      case 8: scores[0] += -0.008825; scores[1] += 0.004779; scores[2] += 0.004046; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.002789; scores[1] += 0.002077; scores[2] += 0.000712; break;
      case 12: scores[0] += -0.007907; scores[1] += 0.002012; scores[2] += 0.005895; break;
      case 13: scores[0] += 0.016353; scores[1] += -0.004128; scores[2] += -0.012226; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.008210; scores[1] += 0.005122; scores[2] += -0.013332; break;
    }
  }

  // Tree 361 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5285947918891907) << 0) | ((features[13] > 0.4082491397857666) << 1) | ((features[10] > 9.416666030883789) << 2) | ((features[10] > 9.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002649; scores[1] += 0.004361; scores[2] += -0.001712; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.005144; scores[1] += -0.018925; scores[2] += 0.013781; break;
      case 3: scores[0] += -0.005834; scores[1] += 0.003899; scores[2] += 0.001935; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.003963; scores[1] += -0.004321; scores[2] += 0.000358; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.011649; scores[1] += -0.016071; scores[2] += 0.004422; break;
      case 11: scores[0] += 0.034597; scores[1] += 0.029222; scores[2] += -0.063818; break;
      case 12: scores[0] += 0.000454; scores[1] += -0.004341; scores[2] += 0.003887; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.020663; scores[1] += 0.010516; scores[2] += 0.010146; break;
      case 15: scores[0] += 0.005063; scores[1] += 0.001917; scores[2] += -0.006981; break;
    }
  }

  // Tree 362 (depth=4)
  {
    const leafIdx = ((features[26] > 0.5) << 0) | ((features[13] > 0.5345238447189331) << 1) | ((features[13] > 0.5370879173278809) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005785; scores[1] += -0.007577; scores[2] += 0.001793; break;
      case 1: scores[0] += -0.012922; scores[1] += 0.021339; scores[2] += -0.008417; break;
      case 2: scores[0] += -0.010454; scores[1] += 0.016975; scores[2] += -0.006521; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.001361; scores[1] += 0.003136; scores[2] += -0.004497; break;
      case 7: scores[0] += -0.001106; scores[1] += 0.003686; scores[2] += -0.002580; break;
      case 8: scores[0] += -0.018275; scores[1] += 0.007941; scores[2] += 0.010334; break;
      case 9: scores[0] += -0.000102; scores[1] += 0.006428; scores[2] += -0.006326; break;
      case 10: scores[0] += 0.026264; scores[1] += -0.003653; scores[2] += -0.022611; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.006786; scores[1] += 0.002798; scores[2] += 0.003988; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 363 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.633333206176758) << 1) | ((features[43] > 0.8516483306884766) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.011352; scores[1] += 0.004456; scores[2] += -0.015807; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.001109; scores[1] += -0.001010; scores[2] += 0.002119; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.006644; scores[1] += -0.000675; scores[2] += -0.005969; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003146; scores[1] += -0.017172; scores[2] += 0.020318; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.004920; scores[1] += 0.002006; scores[2] += 0.002914; break;
      case 9: scores[0] += -0.002054; scores[1] += -0.005283; scores[2] += 0.007337; break;
      case 10: scores[0] += 0.001390; scores[1] += -0.000720; scores[2] += -0.000670; break;
      case 11: scores[0] += -0.006232; scores[1] += 0.020941; scores[2] += -0.014710; break;
      case 12: scores[0] += -0.009780; scores[1] += 0.014358; scores[2] += -0.004578; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.004916; scores[1] += 0.004043; scores[2] += 0.000873; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 364 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[44] > 0.3500000238418579) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000536; scores[1] += 0.002778; scores[2] += -0.002242; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000597; scores[1] += 0.003355; scores[2] += -0.003952; break;
      case 4: scores[0] += 0.007558; scores[1] += -0.011024; scores[2] += 0.003467; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001335; scores[1] += -0.017180; scores[2] += 0.018515; break;
      case 7: scores[0] += -0.001788; scores[1] += -0.003950; scores[2] += 0.005738; break;
      case 8: scores[0] += 0.002940; scores[1] += -0.009090; scores[2] += 0.006150; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.012514; scores[1] += 0.036012; scores[2] += -0.023499; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 365 (depth=4)
  {
    const leafIdx = ((features[43] > 0.6651785373687744) << 0) | ((features[10] > 7.2916669845581055) << 1) | ((features[13] > 0.7871376872062683) << 2) | ((features[43] > 0.1026315838098526) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008597; scores[1] += 0.000616; scores[2] += -0.009213; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000726; scores[1] += -0.001773; scores[2] += 0.002499; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.004916; scores[1] += 0.014677; scores[2] += -0.009761; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.010303; scores[1] += 0.003497; scores[2] += -0.013800; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.017417; scores[1] += -0.004698; scores[2] += 0.022115; break;
      case 9: scores[0] += -0.001012; scores[1] += 0.001392; scores[2] += -0.000379; break;
      case 10: scores[0] += -0.010473; scores[1] += 0.019549; scores[2] += -0.009075; break;
      case 11: scores[0] += -0.000191; scores[1] += 0.015960; scores[2] += -0.015768; break;
      case 12: scores[0] += 0.007361; scores[1] += 0.016004; scores[2] += -0.023365; break;
      case 13: scores[0] += 0.002389; scores[1] += -0.004658; scores[2] += 0.002269; break;
      case 14: scores[0] += -0.016031; scores[1] += -0.008320; scores[2] += 0.024351; break;
      case 15: scores[0] += -0.012686; scores[1] += 0.007089; scores[2] += 0.005597; break;
    }
  }

  // Tree 366 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[29] > 0.5) << 1) | ((features[40] > 0.5) << 2) | ((features[43] > 0.41885966062545776) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004715; scores[1] += -0.001254; scores[2] += -0.003461; break;
      case 1: scores[0] += -0.001490; scores[1] += 0.013697; scores[2] += -0.012207; break;
      case 2: scores[0] += -0.009987; scores[1] += -0.003154; scores[2] += 0.013141; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.002893; scores[1] += -0.002086; scores[2] += 0.004979; break;
      case 5: scores[0] += -0.007103; scores[1] += 0.008428; scores[2] += -0.001325; break;
      case 6: scores[0] += -0.010836; scores[1] += 0.017085; scores[2] += -0.006249; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000764; scores[1] += 0.002469; scores[2] += -0.001705; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000148; scores[1] += -0.010995; scores[2] += 0.011143; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001520; scores[1] += 0.013789; scores[2] += -0.012269; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000036; scores[1] += 0.000249; scores[2] += -0.000213; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 367 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[43] > 0.39642858505249023) << 1) | ((features[10] > 6.366666793823242) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009719; scores[1] += 0.003211; scores[2] += -0.012930; break;
      case 1: scores[0] += -0.012063; scores[1] += 0.009973; scores[2] += 0.002090; break;
      case 2: scores[0] += 0.002702; scores[1] += -0.004585; scores[2] += 0.001883; break;
      case 3: scores[0] += -0.001059; scores[1] += 0.020320; scores[2] += -0.019261; break;
      case 4: scores[0] += -0.002021; scores[1] += -0.001354; scores[2] += 0.003375; break;
      case 5: scores[0] += 0.006355; scores[1] += -0.004480; scores[2] += -0.001875; break;
      case 6: scores[0] += -0.003458; scores[1] += 0.005389; scores[2] += -0.001930; break;
      case 7: scores[0] += -0.000432; scores[1] += 0.004127; scores[2] += -0.003694; break;
      case 8: scores[0] += 0.006096; scores[1] += -0.020864; scores[2] += 0.014769; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.012421; scores[1] += 0.012947; scores[2] += -0.000526; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000517; scores[1] += 0.005781; scores[2] += -0.005265; break;
      case 13: scores[0] += -0.001119; scores[1] += 0.027669; scores[2] += -0.026551; break;
      case 14: scores[0] += -0.002377; scores[1] += -0.030426; scores[2] += 0.032803; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 368 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5313725471496582) << 0) | ((features[19] > 0.5) << 1) | ((features[11] > 0.1507575809955597) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.021285; scores[1] += 0.008253; scores[2] += 0.013032; break;
      case 1: scores[0] += 0.001105; scores[1] += 0.004080; scores[2] += -0.005185; break;
      case 2: scores[0] += 0.023108; scores[1] += -0.011526; scores[2] += -0.011583; break;
      case 3: scores[0] += -0.005987; scores[1] += 0.037411; scores[2] += -0.031423; break;
      case 4: scores[0] += 0.035605; scores[1] += -0.020750; scores[2] += -0.014855; break;
      case 5: scores[0] += 0.012665; scores[1] += -0.011630; scores[2] += -0.001035; break;
      case 6: scores[0] += -0.006848; scores[1] += 0.011465; scores[2] += -0.004616; break;
      case 7: scores[0] += -0.008613; scores[1] += -0.015818; scores[2] += 0.024431; break;
      case 8: scores[0] += 0.000055; scores[1] += 0.003022; scores[2] += -0.003077; break;
      case 9: scores[0] += -0.000293; scores[1] += 0.001753; scores[2] += -0.001460; break;
      case 10: scores[0] += -0.003807; scores[1] += -0.017145; scores[2] += 0.020952; break;
      case 11: scores[0] += -0.001522; scores[1] += 0.007061; scores[2] += -0.005539; break;
      case 12: scores[0] += -0.001123; scores[1] += 0.016678; scores[2] += -0.015555; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002411; scores[1] += -0.000810; scores[2] += 0.003220; break;
      case 15: scores[0] += 0.016007; scores[1] += -0.004146; scores[2] += -0.011862; break;
    }
  }

  // Tree 369 (depth=4)
  {
    const leafIdx = ((features[43] > 0.20942983031272888) << 0) | ((features[29] > 0.5) << 1) | ((features[11] > 0.050641026347875595) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003390; scores[1] += 0.001024; scores[2] += 0.002365; break;
      case 1: scores[0] += -0.001761; scores[1] += 0.011662; scores[2] += -0.009901; break;
      case 2: scores[0] += -0.001586; scores[1] += -0.009699; scores[2] += 0.011285; break;
      case 3: scores[0] += -0.000998; scores[1] += 0.023204; scores[2] += -0.022206; break;
      case 4: scores[0] += 0.006584; scores[1] += -0.004659; scores[2] += -0.001924; break;
      case 5: scores[0] += 0.000374; scores[1] += 0.003409; scores[2] += -0.003783; break;
      case 6: scores[0] += -0.009897; scores[1] += 0.019431; scores[2] += -0.009534; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002793; scores[1] += -0.001854; scores[2] += -0.000939; break;
      case 9: scores[0] += -0.002162; scores[1] += -0.002401; scores[2] += 0.004563; break;
      case 10: scores[0] += -0.009917; scores[1] += 0.035447; scores[2] += -0.025530; break;
      case 11: scores[0] += -0.000427; scores[1] += -0.040981; scores[2] += 0.041408; break;
      case 12: scores[0] += 0.008225; scores[1] += -0.007690; scores[2] += -0.000535; break;
      case 13: scores[0] += -0.020710; scores[1] += 0.027549; scores[2] += -0.006839; break;
      case 14: scores[0] += 0.002938; scores[1] += -0.016284; scores[2] += 0.013345; break;
      case 15: scores[0] += -0.002077; scores[1] += -0.007755; scores[2] += 0.009832; break;
    }
  }

  // Tree 370 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5285947918891907) << 0) | ((features[13] > 0.5370879173278809) << 1) | ((features[14] > 0.5) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000605; scores[1] += -0.005380; scores[2] += 0.005986; break;
      case 1: scores[0] += -0.004962; scores[1] += 0.012960; scores[2] += -0.007998; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.005027; scores[1] += 0.012542; scores[2] += -0.007516; break;
      case 4: scores[0] += -0.006670; scores[1] += 0.007110; scores[2] += -0.000440; break;
      case 5: scores[0] += 0.011939; scores[1] += 0.002500; scores[2] += -0.014439; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.009816; scores[1] += -0.000465; scores[2] += -0.009351; break;
      case 8: scores[0] += 0.000528; scores[1] += -0.001095; scores[2] += 0.000567; break;
      case 9: scores[0] += 0.026159; scores[1] += -0.004176; scores[2] += -0.021984; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.004643; scores[1] += 0.030632; scores[2] += -0.025990; break;
      case 12: scores[0] += -0.002605; scores[1] += 0.003869; scores[2] += -0.001264; break;
      case 13: scores[0] += -0.005822; scores[1] += 0.000442; scores[2] += 0.005380; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.012320; scores[1] += 0.000019; scores[2] += 0.012301; break;
    }
  }

  // Tree 371 (depth=4)
  {
    const leafIdx = ((features[43] > 0.09545454382896423) << 0) | ((features[13] > 0.1026315838098526) << 1) | ((features[13] > 0.15894736349582672) << 2) | ((features[13] > 0.16904762387275696) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002359; scores[1] += 0.004628; scores[2] += -0.002269; break;
      case 1: scores[0] += -0.000401; scores[1] += -0.029287; scores[2] += 0.029688; break;
      case 2: scores[0] += -0.015255; scores[1] += -0.027801; scores[2] += 0.043056; break;
      case 3: scores[0] += -0.007358; scores[1] += 0.030941; scores[2] += -0.023583; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.015524; scores[1] += 0.006895; scores[2] += -0.022419; break;
      case 7: scores[0] += -0.004814; scores[1] += -0.017296; scores[2] += 0.022110; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.006108; scores[1] += -0.001234; scores[2] += -0.004874; break;
      case 15: scores[0] += -0.007898; scores[1] += 0.000447; scores[2] += 0.007451; break;
    }
  }

  // Tree 372 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[35] > 0.5) << 1) | ((features[44] > 0.25) << 2) | ((features[13] > 0.5577777624130249) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003386; scores[1] += 0.000347; scores[2] += -0.003733; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.002091; scores[1] += -0.000276; scores[2] += 0.002367; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.003973; scores[1] += -0.002579; scores[2] += -0.001394; break;
      case 5: scores[0] += -0.009768; scores[1] += -0.018168; scores[2] += 0.027935; break;
      case 6: scores[0] += 0.000598; scores[1] += -0.001141; scores[2] += 0.000542; break;
      case 7: scores[0] += -0.003885; scores[1] += 0.021043; scores[2] += -0.017158; break;
      case 8: scores[0] += -0.000552; scores[1] += -0.003840; scores[2] += 0.004393; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001581; scores[1] += -0.014835; scores[2] += 0.016416; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002246; scores[1] += 0.007644; scores[2] += -0.005398; break;
      case 13: scores[0] += 0.007134; scores[1] += -0.003551; scores[2] += -0.003582; break;
      case 14: scores[0] += -0.002881; scores[1] += 0.012661; scores[2] += -0.009780; break;
      case 15: scores[0] += -0.001568; scores[1] += 0.003867; scores[2] += -0.002299; break;
    }
  }

  // Tree 373 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[34] > 0.25) << 1) | ((features[10] > 10.416666030883789) << 2) | ((features[11] > 0.08957219123840332) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001085; scores[1] += -0.000427; scores[2] += 0.001513; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.038614; scores[1] += 0.002510; scores[2] += -0.041124; break;
      case 3: scores[0] += -0.003758; scores[1] += -0.006988; scores[2] += 0.010746; break;
      case 4: scores[0] += -0.000619; scores[1] += 0.003322; scores[2] += -0.002703; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.015273; scores[1] += 0.001700; scores[2] += 0.013573; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.003784; scores[1] += 0.001301; scores[2] += -0.005085; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.018980; scores[1] += -0.001491; scores[2] += 0.020470; break;
      case 11: scores[0] += -0.006874; scores[1] += -0.001349; scores[2] += 0.008222; break;
      case 12: scores[0] += 0.009344; scores[1] += -0.020568; scores[2] += 0.011224; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.009603; scores[1] += 0.040869; scores[2] += -0.031266; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 374 (depth=4)
  {
    const leafIdx = ((features[13] > 0.1449579894542694) << 0) | ((features[13] > 0.1558704376220703) << 1) | ((features[9] > 3.5) << 2) | ((features[11] > 0.051956817507743835) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004086; scores[1] += -0.000388; scores[2] += -0.003698; break;
      case 1: scores[0] += -0.000306; scores[1] += 0.007971; scores[2] += -0.007665; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.009675; scores[1] += -0.000081; scores[2] += 0.009756; break;
      case 4: scores[0] += -0.003097; scores[1] += 0.029145; scores[2] += -0.026047; break;
      case 5: scores[0] += -0.000019; scores[1] += 0.001450; scores[2] += -0.001430; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.035047; scores[1] += -0.010751; scores[2] += -0.024297; break;
      case 8: scores[0] += -0.005901; scores[1] += 0.006858; scores[2] += -0.000957; break;
      case 9: scores[0] += -0.008089; scores[1] += -0.006316; scores[2] += 0.014405; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.012938; scores[1] += -0.003884; scores[2] += -0.009053; break;
      case 12: scores[0] += -0.022666; scores[1] += 0.007059; scores[2] += 0.015607; break;
      case 13: scores[0] += -0.002032; scores[1] += -0.033269; scores[2] += 0.035300; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.012867; scores[1] += 0.010607; scores[2] += 0.002260; break;
    }
  }

  // Tree 375 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[43] > 0.1913919448852539) << 1) | ((features[13] > 0.2198067605495453) << 2) | ((features[34] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000246; scores[1] += 0.002315; scores[2] += -0.002561; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000723; scores[1] += -0.010148; scores[2] += 0.010871; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.001320; scores[1] += 0.001143; scores[2] += -0.002463; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.002207; scores[1] += -0.002610; scores[2] += 0.004817; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.011623; scores[1] += -0.017596; scores[2] += 0.029219; break;
      case 9: scores[0] += -0.007007; scores[1] += 0.014325; scores[2] += -0.007318; break;
      case 10: scores[0] += -0.000599; scores[1] += -0.026956; scores[2] += 0.027555; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.008843; scores[1] += -0.005807; scores[2] += -0.003036; break;
      case 13: scores[0] += -0.001485; scores[1] += 0.004921; scores[2] += -0.003437; break;
      case 14: scores[0] += -0.000995; scores[1] += 0.016178; scores[2] += -0.015182; break;
      case 15: scores[0] += -0.000127; scores[1] += 0.001631; scores[2] += -0.001503; break;
    }
  }

  // Tree 376 (depth=4)
  {
    const leafIdx = ((features[43] > 0.19615384936332703) << 0) | ((features[10] > 4.224999904632568) << 1) | ((features[44] > 0.550000011920929) << 2) | ((features[43] > 0.8003952503204346) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005577; scores[1] += -0.000150; scores[2] += -0.005427; break;
      case 1: scores[0] += -0.000388; scores[1] += 0.002676; scores[2] += -0.002288; break;
      case 2: scores[0] += -0.000052; scores[1] += 0.001135; scores[2] += -0.001083; break;
      case 3: scores[0] += -0.002007; scores[1] += -0.004727; scores[2] += 0.006734; break;
      case 4: scores[0] += -0.000020; scores[1] += 0.000045; scores[2] += -0.000025; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000106; scores[1] += 0.000572; scores[2] += -0.000466; break;
      case 7: scores[0] += -0.000187; scores[1] += 0.015673; scores[2] += -0.015486; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += -0.018172; scores[1] += 0.012552; scores[2] += 0.005620; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.005627; scores[1] += -0.008245; scores[2] += 0.002619; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.001724; scores[1] += 0.003406; scores[2] += -0.001682; break;
    }
  }

  // Tree 377 (depth=4)
  {
    const leafIdx = ((features[10] > 7.550000190734863) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[3] > 0.5) << 2) | ((features[11] > 0.16333332657814026) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003275; scores[1] += -0.005398; scores[2] += 0.008674; break;
      case 1: scores[0] += 0.004455; scores[1] += 0.000680; scores[2] += -0.005134; break;
      case 2: scores[0] += 0.000088; scores[1] += -0.001429; scores[2] += 0.001341; break;
      case 3: scores[0] += -0.003579; scores[1] += 0.001833; scores[2] += 0.001745; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.008916; scores[1] += 0.007667; scores[2] += 0.001250; break;
      case 7: scores[0] += -0.015824; scores[1] += 0.030890; scores[2] += -0.015066; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.004189; scores[1] += -0.001199; scores[2] += -0.002990; break;
      case 10: scores[0] += 0.016416; scores[1] += 0.006382; scores[2] += -0.022799; break;
      case 11: scores[0] += 0.015245; scores[1] += 0.010107; scores[2] += -0.025352; break;
      case 12: scores[0] += 0.002292; scores[1] += -0.001451; scores[2] += -0.000841; break;
      case 13: scores[0] += 0.003724; scores[1] += -0.002024; scores[2] += -0.001700; break;
      case 14: scores[0] += -0.012834; scores[1] += 0.001065; scores[2] += 0.011770; break;
      case 15: scores[0] += 0.006058; scores[1] += -0.009778; scores[2] += 0.003720; break;
    }
  }

  // Tree 378 (depth=4)
  {
    const leafIdx = ((features[11] > 0.2679487466812134) << 0) | ((features[31] > 0.5) << 1) | ((features[11] > 0.08957219123840332) << 2) | ((features[11] > 0.0944940447807312) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001586; scores[1] += 0.000328; scores[2] += 0.001258; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.005051; scores[1] += -0.001833; scores[2] += -0.003219; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000096; scores[1] += -0.001876; scores[2] += 0.001780; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.015420; scores[1] += 0.039420; scores[2] += -0.024001; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.003756; scores[1] += -0.001036; scores[2] += -0.002721; break;
      case 13: scores[0] += 0.001796; scores[1] += -0.019466; scores[2] += 0.017670; break;
      case 14: scores[0] += -0.005828; scores[1] += 0.005334; scores[2] += 0.000494; break;
      case 15: scores[0] += -0.005011; scores[1] += -0.008054; scores[2] += 0.013065; break;
    }
  }

  // Tree 379 (depth=4)
  {
    const leafIdx = ((features[31] > 0.5) << 0) | ((features[35] > 0.5) << 1) | ((features[9] > 2.5) << 2) | ((features[10] > 10.291666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005417; scores[1] += 0.003175; scores[2] += -0.008592; break;
      case 1: scores[0] += 0.004095; scores[1] += -0.009272; scores[2] += 0.005177; break;
      case 2: scores[0] += -0.000652; scores[1] += -0.010436; scores[2] += 0.011088; break;
      case 3: scores[0] += -0.000200; scores[1] += 0.012186; scores[2] += -0.011986; break;
      case 4: scores[0] += -0.007729; scores[1] += 0.004159; scores[2] += 0.003570; break;
      case 5: scores[0] += 0.007879; scores[1] += -0.003709; scores[2] += -0.004171; break;
      case 6: scores[0] += 0.003688; scores[1] += -0.002667; scores[2] += -0.001021; break;
      case 7: scores[0] += -0.006856; scores[1] += 0.028507; scores[2] += -0.021651; break;
      case 8: scores[0] += -0.002331; scores[1] += 0.000367; scores[2] += 0.001964; break;
      case 9: scores[0] += 0.004351; scores[1] += -0.026434; scores[2] += 0.022083; break;
      case 10: scores[0] += -0.003029; scores[1] += 0.022634; scores[2] += -0.019604; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.013634; scores[1] += -0.015909; scores[2] += 0.002275; break;
      case 13: scores[0] += -0.009381; scores[1] += 0.016594; scores[2] += -0.007213; break;
      case 14: scores[0] += -0.003899; scores[1] += -0.001310; scores[2] += 0.005209; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 380 (depth=4)
  {
    const leafIdx = ((features[11] > 0.03637566417455673) << 0) | ((features[2] > 0.5) << 1) | ((features[31] > 0.5) << 2) | ((features[13] > 0.8360214829444885) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.008715; scores[1] += 0.003019; scores[2] += 0.005696; break;
      case 1: scores[0] += 0.001249; scores[1] += -0.000816; scores[2] += -0.000433; break;
      case 2: scores[0] += -0.001116; scores[1] += 0.025869; scores[2] += -0.024753; break;
      case 3: scores[0] += 0.006845; scores[1] += -0.018110; scores[2] += 0.011265; break;
      case 4: scores[0] += 0.015745; scores[1] += 0.006659; scores[2] += -0.022404; break;
      case 5: scores[0] += -0.000783; scores[1] += 0.002893; scores[2] += -0.002110; break;
      case 6: scores[0] += -0.002783; scores[1] += -0.004828; scores[2] += 0.007611; break;
      case 7: scores[0] += -0.004441; scores[1] += 0.006157; scores[2] += -0.001715; break;
      case 8: scores[0] += 0.006575; scores[1] += 0.010424; scores[2] += -0.016999; break;
      case 9: scores[0] += -0.001734; scores[1] += -0.010906; scores[2] += 0.012640; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.027676; scores[1] += -0.005578; scores[2] += -0.022098; break;
      case 12: scores[0] += 0.011359; scores[1] += -0.014231; scores[2] += 0.002872; break;
      case 13: scores[0] += 0.010646; scores[1] += 0.029065; scores[2] += -0.039711; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.008649; scores[1] += -0.017979; scores[2] += 0.026628; break;
    }
  }

  // Tree 381 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 8.291666030883789) << 1) | ((features[44] > 0.15000000596046448) << 2) | ((features[13] > 0.7958333492279053) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009365; scores[1] += -0.031937; scores[2] += 0.022572; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.016193; scores[1] += -0.001909; scores[2] += -0.014284; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.020789; scores[1] += 0.008880; scores[2] += 0.011909; break;
      case 5: scores[0] += -0.008265; scores[1] += 0.016617; scores[2] += -0.008352; break;
      case 6: scores[0] += -0.001057; scores[1] += 0.002481; scores[2] += -0.001424; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.024069; scores[1] += 0.027485; scores[2] += -0.003415; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.005853; scores[1] += 0.003613; scores[2] += -0.009466; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.009052; scores[1] += 0.000537; scores[2] += -0.009589; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000829; scores[1] += -0.003878; scores[2] += 0.004707; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 382 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8321678638458252) << 0) | ((features[43] > 0.7663043737411499) << 1) | ((features[13] > 0.8550419807434082) << 2) | ((features[10] > 6.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008142; scores[1] += -0.006090; scores[2] += -0.002051; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000157; scores[1] += 0.003058; scores[2] += -0.002901; break;
      case 3: scores[0] += -0.001368; scores[1] += -0.016350; scores[2] += 0.017718; break;
      case 4: scores[0] += -0.023716; scores[1] += 0.034401; scores[2] += -0.010685; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.002013; scores[1] += 0.000825; scores[2] += -0.002838; break;
      case 8: scores[0] += -0.001132; scores[1] += 0.000307; scores[2] += 0.000825; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000175; scores[1] += 0.015495; scores[2] += -0.015320; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.004056; scores[1] += 0.000729; scores[2] += -0.004785; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.004559; scores[1] += -0.000726; scores[2] += 0.005286; break;
    }
  }

  // Tree 383 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5285947918891907) << 0) | ((features[38] > 0.5) << 1) | ((features[13] > 0.4843597412109375) << 2) | ((features[10] > 4.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002960; scores[1] += 0.008580; scores[2] += -0.011540; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000724; scores[1] += -0.033179; scores[2] += 0.033904; break;
      case 5: scores[0] += -0.019986; scores[1] += 0.009404; scores[2] += 0.010582; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.008821; scores[1] += 0.005059; scores[2] += 0.003762; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.016456; scores[1] += -0.016409; scores[2] += -0.000048; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.017653; scores[1] += 0.000273; scores[2] += 0.017380; break;
      case 13: scores[0] += 0.002923; scores[1] += 0.001748; scores[2] += -0.004671; break;
      case 14: scores[0] += -0.011078; scores[1] += -0.014886; scores[2] += 0.025964; break;
      case 15: scores[0] += 0.014475; scores[1] += 0.010860; scores[2] += -0.025335; break;
    }
  }

  // Tree 384 (depth=4)
  {
    const leafIdx = ((features[13] > 0.13188406825065613) << 0) | ((features[10] > 9.291666030883789) << 1) | ((features[44] > 0.15000000596046448) << 2) | ((features[13] > 0.5285947918891907) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010049; scores[1] += -0.037418; scores[2] += 0.027370; break;
      case 1: scores[0] += -0.005290; scores[1] += -0.004479; scores[2] += 0.009769; break;
      case 2: scores[0] += 0.021037; scores[1] += -0.002844; scores[2] += -0.018193; break;
      case 3: scores[0] += -0.001270; scores[1] += 0.013478; scores[2] += -0.012208; break;
      case 4: scores[0] += -0.016729; scores[1] += 0.019087; scores[2] += -0.002358; break;
      case 5: scores[0] += 0.007673; scores[1] += -0.012412; scores[2] += 0.004739; break;
      case 6: scores[0] += -0.024682; scores[1] += 0.005939; scores[2] += 0.018743; break;
      case 7: scores[0] += -0.001428; scores[1] += -0.001097; scores[2] += 0.002525; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += -0.011160; scores[1] += 0.015670; scores[2] += -0.004510; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.004089; scores[1] += 0.004463; scores[2] += -0.008551; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.004229; scores[1] += 0.001113; scores[2] += 0.003116; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.012360; scores[1] += 0.005649; scores[2] += -0.018009; break;
    }
  }

  // Tree 385 (depth=4)
  {
    const leafIdx = ((features[2] > 0.5) << 0) | ((features[11] > 0.06936648488044739) << 1) | ((features[13] > 0.9480432271957397) << 2) | ((features[13] > 0.5577777624130249) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001765; scores[1] += 0.000637; scores[2] += 0.001128; break;
      case 1: scores[0] += -0.002304; scores[1] += -0.009671; scores[2] += 0.011975; break;
      case 2: scores[0] += 0.018486; scores[1] += -0.013678; scores[2] += -0.004808; break;
      case 3: scores[0] += -0.002346; scores[1] += 0.002055; scores[2] += 0.000290; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.009589; scores[1] += -0.003101; scores[2] += -0.006488; break;
      case 9: scores[0] += 0.002855; scores[1] += -0.020348; scores[2] += 0.017492; break;
      case 10: scores[0] += -0.033190; scores[1] += 0.047192; scores[2] += -0.014001; break;
      case 11: scores[0] += 0.019268; scores[1] += -0.004630; scores[2] += -0.014638; break;
      case 12: scores[0] += -0.002224; scores[1] += 0.003690; scores[2] += -0.001466; break;
      case 13: scores[0] += -0.007773; scores[1] += -0.013320; scores[2] += 0.021093; break;
      case 14: scores[0] += 0.033770; scores[1] += -0.021016; scores[2] += -0.012754; break;
      case 15: scores[0] += -0.004585; scores[1] += -0.010786; scores[2] += 0.015371; break;
    }
  }

  // Tree 386 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 5.775000095367432) << 1) | ((features[13] > 0.5345238447189331) << 2) | ((features[10] > 6.099999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005569; scores[1] += -0.011870; scores[2] += 0.006301; break;
      case 1: scores[0] += -0.000012; scores[1] += -0.001399; scores[2] += 0.001411; break;
      case 2: scores[0] += 0.019354; scores[1] += -0.012273; scores[2] += -0.007081; break;
      case 3: scores[0] += -0.000005; scores[1] += 0.000478; scores[2] += -0.000473; break;
      case 4: scores[0] += 0.003332; scores[1] += 0.000554; scores[2] += -0.003886; break;
      case 5: scores[0] += -0.003011; scores[1] += 0.012864; scores[2] += -0.009853; break;
      case 6: scores[0] += -0.021780; scores[1] += 0.030322; scores[2] += -0.008541; break;
      case 7: scores[0] += 0.008273; scores[1] += -0.014475; scores[2] += 0.006201; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.004216; scores[1] += 0.002156; scores[2] += 0.002060; break;
      case 11: scores[0] += -0.000028; scores[1] += -0.002690; scores[2] += 0.002718; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.003429; scores[1] += 0.000438; scores[2] += -0.003867; break;
      case 15: scores[0] += -0.009333; scores[1] += -0.014884; scores[2] += 0.024217; break;
    }
  }

  // Tree 387 (depth=4)
  {
    const leafIdx = ((features[43] > 0.24500000476837158) << 0) | ((features[33] > 0.5) << 1) | ((features[13] > 0.30368906259536743) << 2) | ((features[43] > 0.20416666567325592) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003070; scores[1] += 0.001908; scores[2] += -0.004978; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.016816; scores[1] += 0.019125; scores[2] += -0.002309; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001838; scores[1] += -0.003671; scores[2] += 0.005509; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.004890; scores[1] += -0.004371; scores[2] += -0.000519; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000616; scores[1] += -0.014160; scores[2] += 0.014776; break;
      case 9: scores[0] += -0.006795; scores[1] += -0.005540; scores[2] += 0.012335; break;
      case 10: scores[0] += -0.001325; scores[1] += -0.010872; scores[2] += 0.012197; break;
      case 11: scores[0] += -0.000314; scores[1] += -0.020190; scores[2] += 0.020504; break;
      case 12: scores[0] += 0.006541; scores[1] += 0.008709; scores[2] += -0.015250; break;
      case 13: scores[0] += 0.001418; scores[1] += -0.000228; scores[2] += -0.001190; break;
      case 14: scores[0] += -0.020482; scores[1] += 0.042063; scores[2] += -0.021582; break;
      case 15: scores[0] += -0.011094; scores[1] += 0.004276; scores[2] += 0.006818; break;
    }
  }

  // Tree 388 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[44] > 0.550000011920929) << 1) | ((features[13] > 0.8360214829444885) << 2) | ((features[10] > 7.224999904632568) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004138; scores[1] += -0.003703; scores[2] += -0.000434; break;
      case 1: scores[0] += -0.002457; scores[1] += 0.021679; scores[2] += -0.019222; break;
      case 2: scores[0] += -0.000119; scores[1] += 0.000606; scores[2] += -0.000487; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.003440; scores[1] += 0.026586; scores[2] += -0.023146; break;
      case 5: scores[0] += 0.001990; scores[1] += -0.006414; scores[2] += 0.004424; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.003006; scores[1] += 0.000349; scores[2] += 0.002657; break;
      case 9: scores[0] += -0.004393; scores[1] += 0.007785; scores[2] += -0.003391; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.000179; scores[1] += 0.015198; scores[2] += -0.015019; break;
      case 12: scores[0] += 0.003953; scores[1] += -0.001360; scores[2] += -0.002593; break;
      case 13: scores[0] += -0.012040; scores[1] += 0.004007; scores[2] += 0.008033; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.001707; scores[1] += 0.003303; scores[2] += -0.001596; break;
    }
  }

  // Tree 389 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[13] > 0.8164982795715332) << 1) | ((features[10] > 6.099999904632568) << 2) | ((features[10] > 6.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009352; scores[1] += -0.006487; scores[2] += -0.002865; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.020617; scores[1] += 0.029769; scores[2] += -0.009152; break;
      case 3: scores[0] += 0.000765; scores[1] += -0.003077; scores[2] += 0.002313; break;
      case 4: scores[0] += 0.006602; scores[1] += 0.015447; scores[2] += -0.022049; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.016733; scores[1] += -0.037577; scores[2] += 0.020844; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.004680; scores[1] += 0.001241; scores[2] += 0.003439; break;
      case 13: scores[0] += -0.000179; scores[1] += 0.014992; scores[2] += -0.014814; break;
      case 14: scores[0] += 0.005642; scores[1] += 0.006404; scores[2] += -0.012047; break;
      case 15: scores[0] += -0.004127; scores[1] += -0.001261; scores[2] += 0.005388; break;
    }
  }

  // Tree 390 (depth=4)
  {
    const leafIdx = ((features[43] > 0.41885966062545776) << 0) | ((features[13] > 0.42206478118896484) << 1) | ((features[13] > 0.4258241653442383) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000259; scores[1] += 0.003443; scores[2] += -0.003702; break;
      case 1: scores[0] += -0.000019; scores[1] += 0.025663; scores[2] += -0.025644; break;
      case 2: scores[0] += -0.000855; scores[1] += -0.033216; scores[2] += 0.034071; break;
      case 3: scores[0] += -0.000057; scores[1] += -0.006138; scores[2] += 0.006195; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000161; scores[1] += -0.003111; scores[2] += 0.003272; break;
      case 7: scores[0] += -0.001305; scores[1] += -0.000413; scores[2] += 0.001718; break;
      case 8: scores[0] += -0.010438; scores[1] += 0.004698; scores[2] += 0.005740; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000060; scores[1] += 0.001229; scores[2] += -0.001168; break;
      case 11: scores[0] += -0.000006; scores[1] += 0.000327; scores[2] += -0.000321; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.006343; scores[1] += 0.001276; scores[2] += -0.007619; break;
      case 15: scores[0] += -0.000121; scores[1] += 0.000738; scores[2] += -0.000617; break;
    }
  }

  // Tree 391 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[34] > 0.3500000238418579) << 2) | ((features[10] > 5.775000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000412; scores[1] += -0.000454; scores[2] += 0.000043; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.002326; scores[1] += 0.011811; scores[2] += -0.009484; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.013448; scores[1] += -0.005148; scores[2] += -0.008300; break;
      case 5: scores[0] += -0.002194; scores[1] += -0.005042; scores[2] += 0.007236; break;
      case 6: scores[0] += -0.000649; scores[1] += -0.025465; scores[2] += 0.026114; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000417; scores[1] += 0.000414; scores[2] += -0.000831; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.010824; scores[1] += -0.007303; scores[2] += 0.018128; break;
      case 15: scores[0] += -0.006257; scores[1] += 0.019605; scores[2] += -0.013348; break;
    }
  }

  // Tree 392 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 11.833333969116211) << 1) | ((features[9] > 1.5) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001718; scores[1] += -0.008455; scores[2] += 0.006737; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.008432; scores[1] += 0.016874; scores[2] += -0.025307; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.002272; scores[1] += 0.002658; scores[2] += -0.000386; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.007727; scores[1] += -0.013281; scores[2] += 0.021008; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.021155; scores[1] += -0.005540; scores[2] += -0.015615; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.015956; scores[1] += -0.005642; scores[2] += 0.021598; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.002130; scores[1] += -0.000129; scores[2] += -0.002000; break;
      case 13: scores[0] += -0.008235; scores[1] += 0.014884; scores[2] += -0.006649; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 393 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 6.633333206176758) << 1) | ((features[31] > 0.5) << 2) | ((features[13] > 0.4082491397857666) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.014506; scores[1] += -0.012390; scores[2] += -0.002117; break;
      case 1: scores[0] += -0.000028; scores[1] += -0.000664; scores[2] += 0.000692; break;
      case 2: scores[0] += -0.000390; scores[1] += 0.003007; scores[2] += -0.002618; break;
      case 3: scores[0] += -0.000018; scores[1] += -0.002971; scores[2] += 0.002988; break;
      case 4: scores[0] += -0.012171; scores[1] += 0.007803; scores[2] += 0.004369; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.004715; scores[1] += 0.006019; scores[2] += -0.001304; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.005658; scores[1] += 0.006009; scores[2] += -0.000351; break;
      case 9: scores[0] += 0.004038; scores[1] += 0.008720; scores[2] += -0.012757; break;
      case 10: scores[0] += -0.000262; scores[1] += -0.005141; scores[2] += 0.005403; break;
      case 11: scores[0] += -0.012650; scores[1] += -0.012581; scores[2] += 0.025232; break;
      case 12: scores[0] += 0.017868; scores[1] += 0.003731; scores[2] += -0.021599; break;
      case 13: scores[0] += -0.000551; scores[1] += -0.009849; scores[2] += 0.010401; break;
      case 14: scores[0] += -0.001077; scores[1] += -0.001756; scores[2] += 0.002832; break;
      case 15: scores[0] += 0.003535; scores[1] += -0.002130; scores[2] += -0.001404; break;
    }
  }

  // Tree 394 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[13] > 0.4202037453651428) << 1) | ((features[13] > 0.4258241653442383) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000549; scores[1] += 0.002225; scores[2] += -0.002774; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.001105; scores[1] += 0.037253; scores[2] += -0.036149; break;
      case 3: scores[0] += -0.000877; scores[1] += -0.034394; scores[2] += 0.035272; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.000515; scores[1] += -0.001979; scores[2] += 0.002494; break;
      case 8: scores[0] += -0.009999; scores[1] += 0.004264; scores[2] += 0.005735; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.000065; scores[1] += 0.001523; scores[2] += -0.001458; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.006126; scores[1] += 0.001420; scores[2] += -0.007546; break;
    }
  }

  // Tree 395 (depth=4)
  {
    const leafIdx = ((features[10] > 5.0833330154418945) << 0) | ((features[40] > 0.5) << 1) | ((features[13] > 0.39208072423934937) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.009140; scores[1] += 0.009311; scores[2] += -0.018451; break;
      case 1: scores[0] += -0.004026; scores[1] += -0.000577; scores[2] += 0.004603; break;
      case 2: scores[0] += -0.000181; scores[1] += 0.001273; scores[2] += -0.001092; break;
      case 3: scores[0] += 0.005759; scores[1] += 0.005802; scores[2] += -0.011561; break;
      case 4: scores[0] += -0.001389; scores[1] += 0.013785; scores[2] += -0.012396; break;
      case 5: scores[0] += -0.009948; scores[1] += 0.001298; scores[2] += 0.008650; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.014743; scores[1] += -0.031672; scores[2] += 0.016930; break;
      case 8: scores[0] += -0.002338; scores[1] += 0.007214; scores[2] += -0.004876; break;
      case 9: scores[0] += -0.003430; scores[1] += 0.005035; scores[2] += -0.001605; break;
      case 10: scores[0] += -0.000291; scores[1] += -0.016660; scores[2] += 0.016951; break;
      case 11: scores[0] += 0.003459; scores[1] += -0.001847; scores[2] += -0.001612; break;
      case 12: scores[0] += 0.003008; scores[1] += 0.000778; scores[2] += -0.003786; break;
      case 13: scores[0] += 0.010409; scores[1] += -0.004130; scores[2] += -0.006279; break;
      case 14: scores[0] += -0.000760; scores[1] += 0.001860; scores[2] += -0.001100; break;
      case 15: scores[0] += -0.013365; scores[1] += 0.007513; scores[2] += 0.005852; break;
    }
  }

  // Tree 396 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1558704376220703) << 0) | ((features[33] > 0.5) << 1) | ((features[3] > 0.5) << 2) | ((features[10] > 8.708333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000132; scores[1] += -0.000081; scores[2] += -0.000051; break;
      case 1: scores[0] += 0.026909; scores[1] += -0.001233; scores[2] += -0.025675; break;
      case 2: scores[0] += 0.001646; scores[1] += -0.007079; scores[2] += 0.005433; break;
      case 3: scores[0] += -0.002146; scores[1] += 0.025933; scores[2] += -0.023787; break;
      case 4: scores[0] += -0.012710; scores[1] += 0.025012; scores[2] += -0.012302; break;
      case 5: scores[0] += -0.015122; scores[1] += 0.011421; scores[2] += 0.003701; break;
      case 6: scores[0] += -0.008660; scores[1] += -0.001709; scores[2] += 0.010369; break;
      case 7: scores[0] += -0.001182; scores[1] += -0.013503; scores[2] += 0.014685; break;
      case 8: scores[0] += -0.000652; scores[1] += -0.002163; scores[2] += 0.002815; break;
      case 9: scores[0] += 0.016505; scores[1] += -0.009398; scores[2] += -0.007107; break;
      case 10: scores[0] += -0.008082; scores[1] += 0.018513; scores[2] += -0.010431; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000172; scores[1] += 0.000612; scores[2] += -0.000441; break;
      case 13: scores[0] += 0.000393; scores[1] += -0.004300; scores[2] += 0.003906; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.014861; scores[1] += -0.003907; scores[2] += -0.010954; break;
    }
  }

  // Tree 397 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[10] > 11.583333969116211) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000651; scores[1] += 0.003790; scores[2] += -0.003140; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000923; scores[1] += 0.000709; scores[2] += 0.000214; break;
      case 3: scores[0] += 0.000420; scores[1] += -0.005776; scores[2] += 0.005356; break;
      case 4: scores[0] += -0.006084; scores[1] += -0.016416; scores[2] += 0.022500; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.005764; scores[1] += 0.018180; scores[2] += -0.012416; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.001702; scores[1] += -0.014752; scores[2] += 0.013051; break;
      case 9: scores[0] += 0.004886; scores[1] += 0.002229; scores[2] += -0.007115; break;
      case 10: scores[0] += 0.015083; scores[1] += 0.017931; scores[2] += -0.033015; break;
      case 11: scores[0] += -0.012532; scores[1] += -0.011726; scores[2] += 0.024258; break;
      case 12: scores[0] += 0.008345; scores[1] += 0.016131; scores[2] += -0.024476; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.016144; scores[1] += -0.004068; scores[2] += 0.020212; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 398 (depth=4)
  {
    const leafIdx = ((features[29] > 0.5) << 0) | ((features[43] > 0.0889328122138977) << 1) | ((features[13] > 0.24195122718811035) << 2) | ((features[10] > 8.708333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001047; scores[1] += 0.003537; scores[2] += -0.004584; break;
      case 1: scores[0] += 0.027396; scores[1] += -0.001161; scores[2] += -0.026235; break;
      case 2: scores[0] += -0.004274; scores[1] += 0.014654; scores[2] += -0.010380; break;
      case 3: scores[0] += -0.002975; scores[1] += -0.002142; scores[2] += 0.005117; break;
      case 4: scores[0] += 0.001665; scores[1] += -0.015349; scores[2] += 0.013684; break;
      case 5: scores[0] += -0.024684; scores[1] += 0.039103; scores[2] += -0.014419; break;
      case 6: scores[0] += -0.000892; scores[1] += 0.000877; scores[2] += 0.000016; break;
      case 7: scores[0] += -0.001523; scores[1] += -0.026134; scores[2] += 0.027657; break;
      case 8: scores[0] += -0.001102; scores[1] += -0.005247; scores[2] += 0.006349; break;
      case 9: scores[0] += -0.000349; scores[1] += 0.005990; scores[2] += -0.005640; break;
      case 10: scores[0] += -0.005411; scores[1] += 0.005543; scores[2] += -0.000132; break;
      case 11: scores[0] += -0.003373; scores[1] += -0.029359; scores[2] += 0.032732; break;
      case 12: scores[0] += 0.010880; scores[1] += 0.007777; scores[2] += -0.018657; break;
      case 13: scores[0] += -0.002507; scores[1] += -0.007156; scores[2] += 0.009663; break;
      case 14: scores[0] += -0.019107; scores[1] += 0.012603; scores[2] += 0.006504; break;
      case 15: scores[0] += -0.000978; scores[1] += 0.005785; scores[2] += -0.004807; break;
    }
  }

  // Tree 399 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[9] > 2.5) << 1) | ((features[10] > 10.583333969116211) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000859; scores[1] += -0.003070; scores[2] += 0.003929; break;
      case 1: scores[0] += -0.003881; scores[1] += 0.005169; scores[2] += -0.001288; break;
      case 2: scores[0] += 0.012846; scores[1] += -0.006987; scores[2] += -0.005859; break;
      case 3: scores[0] += -0.029856; scores[1] += 0.019052; scores[2] += 0.010804; break;
      case 4: scores[0] += -0.006075; scores[1] += -0.004255; scores[2] += 0.010330; break;
      case 5: scores[0] += -0.002091; scores[1] += 0.020527; scores[2] += -0.018437; break;
      case 6: scores[0] += -0.000219; scores[1] += 0.008442; scores[2] += -0.008223; break;
      case 7: scores[0] += 0.028120; scores[1] += -0.017267; scores[2] += -0.010853; break;
      case 8: scores[0] += -0.000647; scores[1] += 0.003059; scores[2] += -0.002412; break;
      case 9: scores[0] += 0.015125; scores[1] += -0.010205; scores[2] += -0.004920; break;
      case 10: scores[0] += -0.012985; scores[1] += 0.008801; scores[2] += 0.004185; break;
      case 11: scores[0] += 0.009712; scores[1] += -0.009091; scores[2] += -0.000621; break;
      case 12: scores[0] += 0.010242; scores[1] += -0.023803; scores[2] += 0.013562; break;
      case 13: scores[0] += -0.000580; scores[1] += 0.016681; scores[2] += -0.016100; break;
      case 14: scores[0] += -0.013893; scores[1] += 0.010523; scores[2] += 0.003370; break;
      case 15: scores[0] += -0.008269; scores[1] += 0.008087; scores[2] += 0.000183; break;
    }
  }

  // Tree 400 (depth=4)
  {
    const leafIdx = ((features[34] > 0.25) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[10] > 11.125) << 2) | ((features[10] > 11.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000507; scores[1] += -0.000154; scores[2] += 0.000661; break;
      case 1: scores[0] += 0.011262; scores[1] += -0.008844; scores[2] += -0.002418; break;
      case 2: scores[0] += 0.006260; scores[1] += 0.003291; scores[2] += -0.009551; break;
      case 3: scores[0] += -0.008460; scores[1] += 0.037447; scores[2] += -0.028987; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.011301; scores[1] += -0.029780; scores[2] += 0.018479; break;
      case 7: scores[0] += -0.003737; scores[1] += -0.013245; scores[2] += 0.016982; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003308; scores[1] += 0.003112; scores[2] += 0.000196; break;
      case 15: scores[0] += -0.011473; scores[1] += 0.011167; scores[2] += 0.000307; break;
    }
  }

  // Tree 401 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 6.775000095367432) << 1) | ((features[44] > 0.15000000596046448) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.021796; scores[1] += -0.017768; scores[2] += -0.004028; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.002908; scores[1] += 0.001168; scores[2] += 0.001739; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.016662; scores[1] += -0.004310; scores[2] += -0.012352; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.014096; scores[1] += 0.004756; scores[2] += 0.009339; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.033298; scores[1] += 0.034984; scores[2] += -0.001687; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.021807; scores[1] += -0.015212; scores[2] += -0.006595; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.006370; scores[1] += -0.000369; scores[2] += 0.006740; break;
      case 13: scores[0] += 0.002255; scores[1] += 0.000088; scores[2] += -0.002343; break;
      case 14: scores[0] += 0.003665; scores[1] += 0.003997; scores[2] += -0.007662; break;
      case 15: scores[0] += -0.008965; scores[1] += -0.015428; scores[2] += 0.024393; break;
    }
  }

  // Tree 402 (depth=4)
  {
    const leafIdx = ((features[10] > 7.7083330154418945) << 0) | ((features[9] > 4.5) << 1) | ((features[13] > 0.5345238447189331) << 2) | ((features[19] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.018665; scores[1] += -0.010103; scores[2] += -0.008562; break;
      case 1: scores[0] += -0.021161; scores[1] += 0.008798; scores[2] += 0.012363; break;
      case 2: scores[0] += -0.003047; scores[1] += 0.018744; scores[2] += -0.015697; break;
      case 3: scores[0] += -0.000021; scores[1] += 0.000465; scores[2] += -0.000444; break;
      case 4: scores[0] += -0.000940; scores[1] += 0.002096; scores[2] += -0.001156; break;
      case 5: scores[0] += 0.000823; scores[1] += 0.001031; scores[2] += -0.001854; break;
      case 6: scores[0] += -0.000628; scores[1] += 0.003931; scores[2] += -0.003303; break;
      case 7: scores[0] += -0.000940; scores[1] += 0.013426; scores[2] += -0.012485; break;
      case 8: scores[0] += -0.022631; scores[1] += 0.006438; scores[2] += 0.016193; break;
      case 9: scores[0] += 0.023138; scores[1] += -0.017458; scores[2] += -0.005680; break;
      case 10: scores[0] += -0.007578; scores[1] += 0.012421; scores[2] += -0.004843; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.007289; scores[1] += 0.013646; scores[2] += -0.006357; break;
      case 13: scores[0] += 0.004127; scores[1] += 0.002863; scores[2] += -0.006989; break;
      case 14: scores[0] += -0.000756; scores[1] += 0.001414; scores[2] += -0.000657; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 403 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[31] > 0.5) << 1) | ((features[10] > 7.550000190734863) << 2) | ((features[43] > 0.3060200810432434) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.012048; scores[1] += 0.001785; scores[2] += 0.010262; break;
      case 1: scores[0] += 0.022363; scores[1] += -0.009932; scores[2] += -0.012431; break;
      case 2: scores[0] += -0.002186; scores[1] += 0.010151; scores[2] += -0.007965; break;
      case 3: scores[0] += 0.000722; scores[1] += -0.000515; scores[2] += -0.000207; break;
      case 4: scores[0] += 0.000247; scores[1] += 0.001393; scores[2] += -0.001640; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000310; scores[1] += -0.004659; scores[2] += 0.004349; break;
      case 7: scores[0] += 0.003549; scores[1] += -0.001784; scores[2] += -0.001765; break;
      case 8: scores[0] += 0.003338; scores[1] += -0.006094; scores[2] += 0.002756; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.016869; scores[1] += 0.013380; scores[2] += 0.003489; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.008018; scores[1] += 0.017143; scores[2] += -0.009125; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.026301; scores[1] += -0.026193; scores[2] += -0.000109; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 404 (depth=4)
  {
    const leafIdx = ((features[31] > 0.5) << 0) | ((features[10] > 13.583333969116211) << 1) | ((features[10] > 12.833333969116211) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001059; scores[1] += -0.001658; scores[2] += 0.000600; break;
      case 1: scores[0] += 0.009515; scores[1] += -0.001596; scores[2] += -0.007919; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000114; scores[1] += 0.004977; scores[2] += -0.004863; break;
      case 5: scores[0] += 0.013682; scores[1] += -0.007142; scores[2] += -0.006540; break;
      case 6: scores[0] += -0.004108; scores[1] += 0.017116; scores[2] += -0.013008; break;
      case 7: scores[0] += -0.006673; scores[1] += -0.004213; scores[2] += 0.010887; break;
      case 8: scores[0] += 0.001318; scores[1] += -0.001447; scores[2] += 0.000129; break;
      case 9: scores[0] += -0.003819; scores[1] += 0.003773; scores[2] += 0.000046; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.003581; scores[1] += -0.008146; scores[2] += 0.011727; break;
      case 13: scores[0] += -0.016646; scores[1] += 0.028243; scores[2] += -0.011597; break;
      case 14: scores[0] += 0.007486; scores[1] += 0.012095; scores[2] += -0.019582; break;
      case 15: scores[0] += -0.008705; scores[1] += -0.018593; scores[2] += 0.027297; break;
    }
  }

  // Tree 405 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1408730149269104) << 0) | ((features[9] > 2.5) << 1) | ((features[10] > 9.291666030883789) << 2) | ((features[11] > 0.03077651560306549) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004199; scores[1] += 0.001598; scores[2] += 0.002601; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.007217; scores[1] += -0.003731; scores[2] += -0.003486; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.004942; scores[1] += 0.001167; scores[2] += -0.006110; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.013751; scores[1] += 0.017519; scores[2] += -0.003767; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.009123; scores[1] += 0.006225; scores[2] += 0.002898; break;
      case 9: scores[0] += 0.005878; scores[1] += 0.000147; scores[2] += -0.006025; break;
      case 10: scores[0] += -0.016409; scores[1] += 0.013941; scores[2] += 0.002469; break;
      case 11: scores[0] += 0.002286; scores[1] += -0.011451; scores[2] += 0.009165; break;
      case 12: scores[0] += 0.009796; scores[1] += -0.033425; scores[2] += 0.023629; break;
      case 13: scores[0] += 0.018044; scores[1] += -0.005459; scores[2] += -0.012584; break;
      case 14: scores[0] += 0.005166; scores[1] += -0.004341; scores[2] += -0.000825; break;
      case 15: scores[0] += 0.010324; scores[1] += -0.012004; scores[2] += 0.001680; break;
    }
  }

  // Tree 406 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[43] > 0.4104278087615967) << 1) | ((features[13] > 0.43614131212234497) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004389; scores[1] += 0.000165; scores[2] += 0.004224; break;
      case 1: scores[0] += 0.023942; scores[1] += -0.006592; scores[2] += -0.017351; break;
      case 2: scores[0] += -0.000245; scores[1] += -0.004772; scores[2] += 0.005017; break;
      case 3: scores[0] += -0.000020; scores[1] += 0.025194; scores[2] += -0.025174; break;
      case 4: scores[0] += 0.000869; scores[1] += 0.001423; scores[2] += -0.002292; break;
      case 5: scores[0] += -0.000972; scores[1] += -0.013247; scores[2] += 0.014219; break;
      case 6: scores[0] += 0.000565; scores[1] += 0.005084; scores[2] += -0.005648; break;
      case 7: scores[0] += -0.000114; scores[1] += -0.008082; scores[2] += 0.008196; break;
      case 8: scores[0] += -0.008272; scores[1] += 0.001536; scores[2] += 0.006736; break;
      case 9: scores[0] += -0.006997; scores[1] += 0.000561; scores[2] += 0.006436; break;
      case 10: scores[0] += -0.000145; scores[1] += 0.000805; scores[2] += -0.000660; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.011424; scores[1] += -0.003739; scores[2] += -0.007685; break;
      case 13: scores[0] += -0.010240; scores[1] += 0.034063; scores[2] += -0.023823; break;
      case 14: scores[0] += -0.002137; scores[1] += -0.010300; scores[2] += 0.012437; break;
      case 15: scores[0] += -0.001173; scores[1] += 0.010658; scores[2] += -0.009485; break;
    }
  }

  // Tree 407 (depth=4)
  {
    const leafIdx = ((features[10] > 7.2916669845581055) << 0) | ((features[10] > 7.550000190734863) << 1) | ((features[9] > 2.5) << 2) | ((features[13] > 0.3623737394809723) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010286; scores[1] += -0.005995; scores[2] += -0.004291; break;
      case 1: scores[0] += -0.001971; scores[1] += -0.012087; scores[2] += 0.014057; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.004842; scores[1] += -0.002107; scores[2] += -0.002736; break;
      case 4: scores[0] += -0.009594; scores[1] += 0.007396; scores[2] += 0.002197; break;
      case 5: scores[0] += -0.004798; scores[1] += -0.000059; scores[2] += 0.004856; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.001470; scores[1] += 0.003203; scores[2] += -0.004673; break;
      case 8: scores[0] += 0.001000; scores[1] += 0.003250; scores[2] += -0.004250; break;
      case 9: scores[0] += -0.007167; scores[1] += -0.039344; scores[2] += 0.046511; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.001769; scores[1] += 0.004750; scores[2] += -0.006520; break;
      case 12: scores[0] += 0.007553; scores[1] += -0.001126; scores[2] += -0.006427; break;
      case 13: scores[0] += -0.008617; scores[1] += -0.001152; scores[2] += 0.009768; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.002059; scores[1] += -0.002489; scores[2] += 0.004549; break;
    }
  }

  // Tree 408 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8550419807434082) << 0) | ((features[9] > 2.5) << 1) | ((features[10] > 13.583333969116211) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.007870; scores[1] += 0.002809; scores[2] += 0.005061; break;
      case 1: scores[0] += -0.002341; scores[1] += -0.007594; scores[2] += 0.009935; break;
      case 2: scores[0] += -0.000727; scores[1] += -0.001819; scores[2] += 0.002547; break;
      case 3: scores[0] += 0.007603; scores[1] += 0.011049; scores[2] += -0.018651; break;
      case 4: scores[0] += 0.012447; scores[1] += -0.004730; scores[2] += -0.007717; break;
      case 5: scores[0] += -0.004932; scores[1] += 0.021036; scores[2] += -0.016104; break;
      case 6: scores[0] += -0.002738; scores[1] += 0.022196; scores[2] += -0.019458; break;
      case 7: scores[0] += -0.018247; scores[1] += -0.011368; scores[2] += 0.029614; break;
      case 8: scores[0] += 0.003648; scores[1] += 0.008367; scores[2] += -0.012015; break;
      case 9: scores[0] += 0.031033; scores[1] += -0.017960; scores[2] += -0.013073; break;
      case 10: scores[0] += 0.005463; scores[1] += 0.002071; scores[2] += -0.007534; break;
      case 11: scores[0] += -0.015478; scores[1] += 0.007428; scores[2] += 0.008049; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += -0.007147; scores[1] += -0.001644; scores[2] += 0.008790; break;
      case 14: scores[0] += -0.003582; scores[1] += -0.008138; scores[2] += 0.011720; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 409 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5577777624130249) << 0) | ((features[14] > 0.5) << 1) | ((features[34] > 0.05000000074505806) << 2) | ((features[10] > 8.708333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005558; scores[1] += -0.001290; scores[2] += -0.004268; break;
      case 1: scores[0] += -0.007054; scores[1] += 0.041802; scores[2] += -0.034748; break;
      case 2: scores[0] += -0.009261; scores[1] += -0.015829; scores[2] += 0.025090; break;
      case 3: scores[0] += -0.020331; scores[1] += 0.018649; scores[2] += 0.001682; break;
      case 4: scores[0] += 0.009889; scores[1] += -0.022127; scores[2] += 0.012237; break;
      case 5: scores[0] += 0.014748; scores[1] += -0.030482; scores[2] += 0.015733; break;
      case 6: scores[0] += -0.006935; scores[1] += 0.015427; scores[2] += -0.008492; break;
      case 7: scores[0] += -0.000434; scores[1] += -0.003123; scores[2] += 0.003558; break;
      case 8: scores[0] += 0.015907; scores[1] += -0.009421; scores[2] += -0.006486; break;
      case 9: scores[0] += -0.026333; scores[1] += 0.024834; scores[2] += 0.001499; break;
      case 10: scores[0] += -0.017216; scores[1] += 0.002385; scores[2] += 0.014831; break;
      case 11: scores[0] += 0.041214; scores[1] += -0.038818; scores[2] += -0.002396; break;
      case 12: scores[0] += -0.010500; scores[1] += -0.011252; scores[2] += 0.021752; break;
      case 13: scores[0] += 0.027273; scores[1] += -0.025997; scores[2] += -0.001277; break;
      case 14: scores[0] += 0.003883; scores[1] += 0.007008; scores[2] += -0.010891; break;
      case 15: scores[0] += -0.004336; scores[1] += 0.013829; scores[2] += -0.009492; break;
    }
  }

  // Tree 410 (depth=4)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[11] > 0.037749290466308594) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010519; scores[1] += 0.001959; scores[2] += -0.012478; break;
      case 1: scores[0] += -0.024657; scores[1] += -0.002522; scores[2] += 0.027179; break;
      case 2: scores[0] += -0.009259; scores[1] += 0.000694; scores[2] += 0.008565; break;
      case 3: scores[0] += -0.000970; scores[1] += 0.021279; scores[2] += -0.020309; break;
      case 4: scores[0] += -0.006086; scores[1] += 0.000458; scores[2] += 0.005628; break;
      case 5: scores[0] += -0.005027; scores[1] += -0.000187; scores[2] += 0.005213; break;
      case 6: scores[0] += 0.015680; scores[1] += -0.012154; scores[2] += -0.003526; break;
      case 7: scores[0] += -0.000274; scores[1] += 0.002570; scores[2] += -0.002296; break;
      case 8: scores[0] += -0.028964; scores[1] += 0.004358; scores[2] += 0.024606; break;
      case 9: scores[0] += 0.016504; scores[1] += 0.001462; scores[2] += -0.017966; break;
      case 10: scores[0] += 0.005757; scores[1] += 0.003590; scores[2] += -0.009347; break;
      case 11: scores[0] += -0.001121; scores[1] += 0.006077; scores[2] += -0.004957; break;
      case 12: scores[0] += 0.004546; scores[1] += -0.006249; scores[2] += 0.001703; break;
      case 13: scores[0] += 0.009730; scores[1] += 0.011545; scores[2] += -0.021276; break;
      case 14: scores[0] += -0.009202; scores[1] += 0.001309; scores[2] += 0.007893; break;
      case 15: scores[0] += -0.001753; scores[1] += -0.003134; scores[2] += 0.004886; break;
    }
  }

  // Tree 411 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[10] > 7.550000190734863) << 1) | ((features[10] > 4.7083330154418945) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002110; scores[1] += 0.008477; scores[2] += -0.010588; break;
      case 1: scores[0] += -0.018999; scores[1] += 0.004115; scores[2] += 0.014884; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.007272; scores[1] += 0.002761; scores[2] += 0.004511; break;
      case 5: scores[0] += 0.013424; scores[1] += -0.010825; scores[2] += -0.002599; break;
      case 6: scores[0] += 0.002661; scores[1] += -0.000682; scores[2] += -0.001979; break;
      case 7: scores[0] += -0.007656; scores[1] += 0.009667; scores[2] += -0.002011; break;
      case 8: scores[0] += -0.003053; scores[1] += -0.033946; scores[2] += 0.037000; break;
      case 9: scores[0] += -0.004748; scores[1] += 0.024071; scores[2] += -0.019323; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.001010; scores[1] += 0.005427; scores[2] += -0.006437; break;
      case 13: scores[0] += -0.007802; scores[1] += -0.007320; scores[2] += 0.015123; break;
      case 14: scores[0] += -0.001361; scores[1] += 0.000449; scores[2] += 0.000912; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 412 (depth=4)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[40] > 0.5) << 1) | ((features[4] > 0.5) << 2) | ((features[10] > 8.100000381469727) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.014300; scores[1] += 0.001320; scores[2] += -0.015620; break;
      case 1: scores[0] += -0.009400; scores[1] += -0.014645; scores[2] += 0.024046; break;
      case 2: scores[0] += -0.035222; scores[1] += 0.006144; scores[2] += 0.029078; break;
      case 3: scores[0] += -0.005412; scores[1] += 0.028910; scores[2] += -0.023498; break;
      case 4: scores[0] += -0.007642; scores[1] += -0.005083; scores[2] += 0.012725; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.008028; scores[1] += -0.005211; scores[2] += -0.002817; break;
      case 7: scores[0] += 0.016285; scores[1] += -0.007735; scores[2] += -0.008550; break;
      case 8: scores[0] += -0.002635; scores[1] += -0.000464; scores[2] += 0.003100; break;
      case 9: scores[0] += -0.007034; scores[1] += 0.013375; scores[2] += -0.006341; break;
      case 10: scores[0] += -0.002125; scores[1] += 0.001428; scores[2] += 0.000697; break;
      case 11: scores[0] += 0.006023; scores[1] += -0.005008; scores[2] += -0.001015; break;
      case 12: scores[0] += 0.012798; scores[1] += 0.006766; scores[2] += -0.019564; break;
      case 13: scores[0] += -0.017301; scores[1] += -0.005545; scores[2] += 0.022846; break;
      case 14: scores[0] += 0.006728; scores[1] += 0.003854; scores[2] += -0.010582; break;
      case 15: scores[0] += 0.010993; scores[1] += -0.004412; scores[2] += -0.006581; break;
    }
  }

  // Tree 413 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[13] > 0.5577777624130249) << 1) | ((features[13] > 0.5779352188110352) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007472; scores[1] += -0.007154; scores[2] += -0.000318; break;
      case 1: scores[0] += -0.007507; scores[1] += 0.012391; scores[2] += -0.004884; break;
      case 2: scores[0] += 0.003217; scores[1] += 0.021951; scores[2] += -0.025168; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.011021; scores[1] += 0.008960; scores[2] += 0.002061; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.006831; scores[1] += 0.007113; scores[2] += -0.000282; break;
      case 9: scores[0] += -0.000177; scores[1] += 0.002441; scores[2] += -0.002264; break;
      case 10: scores[0] += 0.003093; scores[1] += 0.018055; scores[2] += -0.021148; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.001414; scores[1] += -0.003448; scores[2] += 0.002035; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 414 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[43] > 0.22653958201408386) << 1) | ((features[43] > 0.2158385068178177) << 2) | ((features[10] > 7.7083330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000520; scores[1] += 0.002665; scores[2] += -0.003185; break;
      case 1: scores[0] += 0.003618; scores[1] += 0.001800; scores[2] += -0.005418; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.004602; scores[1] += 0.029250; scores[2] += -0.024648; break;
      case 5: scores[0] += -0.000649; scores[1] += -0.026549; scores[2] += 0.027197; break;
      case 6: scores[0] += -0.006356; scores[1] += -0.002439; scores[2] += 0.008795; break;
      case 7: scores[0] += -0.000962; scores[1] += 0.016274; scores[2] += -0.015313; break;
      case 8: scores[0] += 0.002502; scores[1] += -0.000785; scores[2] += -0.001718; break;
      case 9: scores[0] += -0.012968; scores[1] += -0.022965; scores[2] += 0.035932; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.006762; scores[1] += 0.011747; scores[2] += -0.004984; break;
      case 13: scores[0] += -0.000125; scores[1] += 0.000526; scores[2] += -0.000400; break;
      case 14: scores[0] += 0.000129; scores[1] += -0.002129; scores[2] += 0.002000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 415 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[11] > 0.027402402833104134) << 2) | ((features[11] > 0.03637566417455673) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004033; scores[1] += 0.000048; scores[2] += -0.004082; break;
      case 1: scores[0] += -0.000175; scores[1] += 0.002384; scores[2] += -0.002209; break;
      case 2: scores[0] += -0.000616; scores[1] += 0.001572; scores[2] += -0.000956; break;
      case 3: scores[0] += -0.001399; scores[1] += 0.004474; scores[2] += -0.003075; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.009236; scores[1] += -0.004941; scores[2] += 0.014177; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.007609; scores[1] += 0.001356; scores[2] += 0.006254; break;
      case 13: scores[0] += -0.001765; scores[1] += -0.008044; scores[2] += 0.009810; break;
      case 14: scores[0] += 0.002059; scores[1] += -0.003682; scores[2] += 0.001623; break;
      case 15: scores[0] += -0.004597; scores[1] += 0.014832; scores[2] += -0.010235; break;
    }
  }

  // Tree 416 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8164982795715332) << 0) | ((features[13] > 0.8245074152946472) << 1) | ((features[11] > 0.06155303120613098) << 2) | ((features[11] > 0.05634920671582222) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004473; scores[1] += 0.002048; scores[2] += 0.002426; break;
      case 1: scores[0] += -0.002714; scores[1] += 0.015931; scores[2] += -0.013218; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.002134; scores[1] += 0.000394; scores[2] += -0.002528; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.011678; scores[1] += 0.008983; scores[2] += 0.002695; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.023264; scores[1] += 0.040922; scores[2] += -0.017657; break;
      case 12: scores[0] += 0.003660; scores[1] += -0.005368; scores[2] += 0.001708; break;
      case 13: scores[0] += 0.024620; scores[1] += -0.001904; scores[2] += -0.022716; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.004959; scores[1] += -0.014902; scores[2] += 0.009943; break;
    }
  }

  // Tree 417 (depth=4)
  {
    const leafIdx = ((features[10] > 4.7083330154418945) << 0) | ((features[33] > 0.5) << 1) | ((features[43] > 0.8516483306884766) << 2) | ((features[9] > 3.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003398; scores[1] += 0.001604; scores[2] += -0.005002; break;
      case 1: scores[0] += 0.000535; scores[1] += -0.000816; scores[2] += 0.000281; break;
      case 2: scores[0] += -0.002485; scores[1] += -0.034817; scores[2] += 0.037301; break;
      case 3: scores[0] += -0.003821; scores[1] += 0.006460; scores[2] += -0.002639; break;
      case 4: scores[0] += -0.017975; scores[1] += 0.004617; scores[2] += 0.013358; break;
      case 5: scores[0] += 0.007761; scores[1] += -0.002372; scores[2] += -0.005389; break;
      case 6: scores[0] += -0.004744; scores[1] += 0.023476; scores[2] += -0.018732; break;
      case 7: scores[0] += -0.007867; scores[1] += -0.006936; scores[2] += 0.014803; break;
      case 8: scores[0] += -0.001668; scores[1] += 0.009826; scores[2] += -0.008158; break;
      case 9: scores[0] += -0.000651; scores[1] += 0.003376; scores[2] += -0.002724; break;
      case 10: scores[0] += -0.000508; scores[1] += 0.002125; scores[2] += -0.001617; break;
      case 11: scores[0] += 0.002708; scores[1] += -0.005058; scores[2] += 0.002350; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 418 (depth=4)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[10] > 10.416666030883789) << 2) | ((features[13] > 0.5577777624130249) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006136; scores[1] += 0.004222; scores[2] += -0.010357; break;
      case 1: scores[0] += 0.001912; scores[1] += -0.006173; scores[2] += 0.004261; break;
      case 2: scores[0] += 0.001849; scores[1] += -0.003210; scores[2] += 0.001360; break;
      case 3: scores[0] += 0.000192; scores[1] += 0.001160; scores[2] += -0.001352; break;
      case 4: scores[0] += -0.000074; scores[1] += -0.004805; scores[2] += 0.004879; break;
      case 5: scores[0] += -0.002606; scores[1] += 0.020829; scores[2] += -0.018223; break;
      case 6: scores[0] += 0.002498; scores[1] += -0.005919; scores[2] += 0.003422; break;
      case 7: scores[0] += -0.001530; scores[1] += 0.000824; scores[2] += 0.000706; break;
      case 8: scores[0] += -0.000492; scores[1] += -0.005836; scores[2] += 0.006328; break;
      case 9: scores[0] += -0.001566; scores[1] += -0.014442; scores[2] += 0.016008; break;
      case 10: scores[0] += -0.001168; scores[1] += 0.003591; scores[2] += -0.002422; break;
      case 11: scores[0] += -0.004085; scores[1] += 0.014366; scores[2] += -0.010282; break;
      case 12: scores[0] += 0.002425; scores[1] += 0.002475; scores[2] += -0.004900; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.007699; scores[1] += 0.014867; scores[2] += -0.007168; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 419 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 5.900000095367432) << 1) | ((features[13] > 0.2198067605495453) << 2) | ((features[43] > 0.20942983031272888) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003451; scores[1] += -0.004708; scores[2] += 0.001256; break;
      case 1: scores[0] += -0.002122; scores[1] += -0.016228; scores[2] += 0.018350; break;
      case 2: scores[0] += -0.000849; scores[1] += 0.003129; scores[2] += -0.002280; break;
      case 3: scores[0] += -0.015289; scores[1] += 0.001516; scores[2] += 0.013773; break;
      case 4: scores[0] += -0.007437; scores[1] += 0.020725; scores[2] += -0.013288; break;
      case 5: scores[0] += 0.013062; scores[1] += -0.006750; scores[2] += -0.006311; break;
      case 6: scores[0] += 0.002999; scores[1] += -0.002447; scores[2] += -0.000552; break;
      case 7: scores[0] += -0.003919; scores[1] += 0.001973; scores[2] += 0.001946; break;
      case 8: scores[0] += -0.000152; scores[1] += 0.001022; scores[2] += -0.000870; break;
      case 9: scores[0] += -0.000646; scores[1] += -0.026059; scores[2] += 0.026705; break;
      case 10: scores[0] += 0.001078; scores[1] += -0.018822; scores[2] += 0.017744; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001133; scores[1] += -0.001560; scores[2] += 0.002692; break;
      case 13: scores[0] += -0.000918; scores[1] += 0.014818; scores[2] += -0.013900; break;
      case 14: scores[0] += -0.007331; scores[1] += 0.003910; scores[2] += 0.003421; break;
      case 15: scores[0] += -0.000166; scores[1] += 0.002374; scores[2] += -0.002208; break;
    }
  }

  // Tree 420 (depth=4)
  {
    const leafIdx = ((features[34] > 0.05000000074505806) << 0) | ((features[14] > 0.5) << 1) | ((features[9] > 2.5) << 2) | ((features[13] > 0.568323016166687) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007297; scores[1] += -0.009280; scores[2] += 0.001982; break;
      case 1: scores[0] += 0.001848; scores[1] += -0.005689; scores[2] += 0.003841; break;
      case 2: scores[0] += -0.016700; scores[1] += 0.018503; scores[2] += -0.001802; break;
      case 3: scores[0] += -0.004025; scores[1] += 0.024240; scores[2] += -0.020214; break;
      case 4: scores[0] += 0.011295; scores[1] += -0.000012; scores[2] += -0.011283; break;
      case 5: scores[0] += 0.002673; scores[1] += -0.019395; scores[2] += 0.016722; break;
      case 6: scores[0] += -0.005107; scores[1] += -0.041731; scores[2] += 0.046839; break;
      case 7: scores[0] += 0.006211; scores[1] += 0.006748; scores[2] += -0.012958; break;
      case 8: scores[0] += -0.014585; scores[1] += 0.029171; scores[2] += -0.014586; break;
      case 9: scores[0] += 0.029076; scores[1] += -0.027586; scores[2] += -0.001490; break;
      case 10: scores[0] += 0.031626; scores[1] += -0.029258; scores[2] += -0.002367; break;
      case 11: scores[0] += -0.005910; scores[1] += -0.004344; scores[2] += 0.010254; break;
      case 12: scores[0] += -0.021844; scores[1] += 0.025581; scores[2] += -0.003738; break;
      case 13: scores[0] += -0.005542; scores[1] += -0.015768; scores[2] += 0.021310; break;
      case 14: scores[0] += -0.005992; scores[1] += 0.011331; scores[2] += -0.005340; break;
      case 15: scores[0] += -0.002304; scores[1] += 0.003300; scores[2] += -0.000996; break;
    }
  }

  // Tree 421 (depth=4)
  {
    const leafIdx = ((features[10] > 7.4166669845581055) << 0) | ((features[10] > 8.100000381469727) << 1) | ((features[13] > 0.024725275114178658) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005141; scores[1] += 0.004742; scores[2] += -0.009883; break;
      case 1: scores[0] += -0.033660; scores[1] += -0.016575; scores[2] += 0.050235; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.002638; scores[1] += 0.004447; scores[2] += -0.001809; break;
      case 4: scores[0] += 0.004902; scores[1] += -0.000981; scores[2] += -0.003921; break;
      case 5: scores[0] += 0.006517; scores[1] += 0.010022; scores[2] += -0.016539; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.001510; scores[1] += -0.000834; scores[2] += -0.000676; break;
      case 8: scores[0] += -0.009238; scores[1] += 0.016757; scores[2] += -0.007520; break;
      case 9: scores[0] += 0.015686; scores[1] += 0.005054; scores[2] += -0.020740; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.008896; scores[1] += -0.007008; scores[2] += -0.001888; break;
      case 12: scores[0] += -0.023925; scores[1] += 0.004516; scores[2] += 0.019409; break;
      case 13: scores[0] += -0.017238; scores[1] += 0.001694; scores[2] += 0.015544; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.002659; scores[1] += 0.003523; scores[2] += -0.000864; break;
    }
  }

  // Tree 422 (depth=4)
  {
    const leafIdx = ((features[43] > 0.9285714626312256) << 0) | ((features[10] > 9.583333969116211) << 1) | ((features[10] > 10.583333969116211) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001701; scores[1] += 0.001340; scores[2] += 0.000361; break;
      case 1: scores[0] += -0.002951; scores[1] += 0.004831; scores[2] += -0.001880; break;
      case 2: scores[0] += -0.007517; scores[1] += -0.005592; scores[2] += 0.013108; break;
      case 3: scores[0] += 0.027413; scores[1] += -0.016717; scores[2] += -0.010696; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000265; scores[1] += -0.000316; scores[2] += 0.000051; break;
      case 7: scores[0] += -0.017137; scores[1] += -0.002485; scores[2] += 0.019622; break;
      case 8: scores[0] += 0.012941; scores[1] += -0.003828; scores[2] += -0.009112; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.005120; scores[1] += -0.007326; scores[2] += 0.012446; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000088; scores[1] += 0.016566; scores[2] += -0.016654; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 423 (depth=4)
  {
    const leafIdx = ((features[10] > 9.708333969116211) << 0) | ((features[13] > 0.8495475053787231) << 1) | ((features[13] > 0.8360214829444885) << 2) | ((features[10] > 9.125) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006770; scores[1] += 0.002822; scores[2] += 0.003948; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001458; scores[1] += -0.013680; scores[2] += 0.015138; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000281; scores[1] += 0.004571; scores[2] += -0.004290; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.027377; scores[1] += -0.010783; scores[2] += -0.016594; break;
      case 9: scores[0] += -0.007076; scores[1] += 0.001692; scores[2] += 0.005384; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.011670; scores[1] += 0.007695; scores[2] += -0.019366; break;
      case 14: scores[0] += -0.015777; scores[1] += 0.032226; scores[2] += -0.016448; break;
      case 15: scores[0] += 0.001445; scores[1] += -0.009589; scores[2] += 0.008144; break;
    }
  }

  // Tree 424 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[9] > 2.5) << 1) | ((features[10] > 9.291666030883789) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.008828; scores[1] += 0.004138; scores[2] += 0.004689; break;
      case 1: scores[0] += -0.002580; scores[1] += 0.003286; scores[2] += -0.000706; break;
      case 2: scores[0] += -0.007802; scores[1] += 0.002138; scores[2] += 0.005664; break;
      case 3: scores[0] += -0.008850; scores[1] += 0.009798; scores[2] += -0.000948; break;
      case 4: scores[0] += 0.000044; scores[1] += -0.002495; scores[2] += 0.002451; break;
      case 5: scores[0] += 0.008317; scores[1] += -0.008210; scores[2] += -0.000107; break;
      case 6: scores[0] += 0.009067; scores[1] += -0.003392; scores[2] += -0.005675; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.010764; scores[1] += -0.003332; scores[2] += -0.007432; break;
      case 9: scores[0] += -0.000177; scores[1] += 0.006274; scores[2] += -0.006098; break;
      case 10: scores[0] += 0.006989; scores[1] += -0.003030; scores[2] += -0.003959; break;
      case 11: scores[0] += -0.001101; scores[1] += 0.008494; scores[2] += -0.007393; break;
      case 12: scores[0] += 0.017260; scores[1] += -0.015534; scores[2] += -0.001726; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.011617; scores[1] += 0.016471; scores[2] += -0.004854; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 425 (depth=4)
  {
    const leafIdx = ((features[43] > 0.43614131212234497) << 0) | ((features[43] > 0.09545454382896423) << 1) | ((features[13] > 0.1026315838098526) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003025; scores[1] += 0.003225; scores[2] += -0.006250; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000338; scores[1] += -0.028908; scores[2] += 0.029246; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.002014; scores[1] += -0.009607; scores[2] += 0.011621; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.009108; scores[1] += 0.020103; scores[2] += -0.010995; break;
      case 7: scores[0] += -0.002960; scores[1] += 0.011750; scores[2] += -0.008790; break;
      case 8: scores[0] += -0.008373; scores[1] += -0.021072; scores[2] += 0.029445; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.010118; scores[1] += 0.006630; scores[2] += -0.016747; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.017396; scores[1] += -0.010468; scores[2] += 0.027865; break;
      case 15: scores[0] += -0.001059; scores[1] += 0.000361; scores[2] += 0.000698; break;
    }
  }

  // Tree 426 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[44] > 0.25) << 1) | ((features[10] > 4.2916669845581055) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005342; scores[1] += -0.004659; scores[2] += -0.000682; break;
      case 1: scores[0] += -0.016805; scores[1] += 0.004375; scores[2] += 0.012430; break;
      case 2: scores[0] += -0.001337; scores[1] += 0.006552; scores[2] += -0.005215; break;
      case 3: scores[0] += -0.003275; scores[1] += 0.017134; scores[2] += -0.013859; break;
      case 4: scores[0] += 0.000601; scores[1] += 0.000244; scores[2] += -0.000845; break;
      case 5: scores[0] += 0.013898; scores[1] += -0.007776; scores[2] += -0.006122; break;
      case 6: scores[0] += -0.000395; scores[1] += -0.000337; scores[2] += 0.000732; break;
      case 7: scores[0] += -0.006419; scores[1] += 0.001600; scores[2] += 0.004819; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000104; scores[1] += 0.001289; scores[2] += -0.001185; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001007; scores[1] += -0.001394; scores[2] += 0.002401; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003959; scores[1] += 0.003914; scores[2] += 0.000045; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 427 (depth=4)
  {
    const leafIdx = ((features[10] > 9.583333969116211) << 0) | ((features[10] > 9.291666030883789) << 1) | ((features[13] > 0.42206478118896484) << 2) | ((features[34] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006760; scores[1] += 0.008338; scores[2] += -0.001578; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.007246; scores[1] += 0.002920; scores[2] += 0.004326; break;
      case 3: scores[0] += 0.006579; scores[1] += -0.008081; scores[2] += 0.001501; break;
      case 4: scores[0] += -0.007268; scores[1] += -0.002700; scores[2] += 0.009968; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.045030; scores[1] += 0.001281; scores[2] += -0.046311; break;
      case 7: scores[0] += -0.001860; scores[1] += -0.002839; scores[2] += 0.004700; break;
      case 8: scores[0] += 0.007721; scores[1] += -0.002557; scores[2] += -0.005164; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.008342; scores[1] += -0.002886; scores[2] += -0.005456; break;
      case 11: scores[0] += -0.015494; scores[1] += 0.007746; scores[2] += 0.007748; break;
      case 12: scores[0] += 0.007512; scores[1] += -0.008229; scores[2] += 0.000717; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000746; scores[1] += -0.000509; scores[2] += -0.000236; break;
      case 15: scores[0] += -0.007796; scores[1] += 0.019159; scores[2] += -0.011363; break;
    }
  }

  // Tree 428 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8550419807434082) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[43] > 0.6651785373687744) << 2) | ((features[34] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001337; scores[1] += -0.000813; scores[2] += 0.002150; break;
      case 1: scores[0] += 0.000845; scores[1] += 0.004778; scores[2] += -0.005624; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001306; scores[1] += 0.011377; scores[2] += -0.010071; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001412; scores[1] += -0.013157; scores[2] += 0.014569; break;
      case 7: scores[0] += 0.000268; scores[1] += 0.001086; scores[2] += -0.001354; break;
      case 8: scores[0] += 0.004768; scores[1] += 0.002290; scores[2] += -0.007058; break;
      case 9: scores[0] += 0.005839; scores[1] += -0.008300; scores[2] += 0.002461; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 429 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[35] > 0.5) << 1) | ((features[23] > 0.5) << 2) | ((features[10] > 7.900000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003119; scores[1] += -0.002453; scores[2] += -0.000666; break;
      case 1: scores[0] += -0.023445; scores[1] += 0.006412; scores[2] += 0.017032; break;
      case 2: scores[0] += -0.007903; scores[1] += -0.003140; scores[2] += 0.011043; break;
      case 3: scores[0] += -0.001704; scores[1] += 0.024678; scores[2] += -0.022973; break;
      case 4: scores[0] += -0.002374; scores[1] += 0.013714; scores[2] += -0.011339; break;
      case 5: scores[0] += -0.000294; scores[1] += 0.002660; scores[2] += -0.002366; break;
      case 6: scores[0] += -0.002586; scores[1] += 0.031104; scores[2] += -0.028518; break;
      case 7: scores[0] += -0.000048; scores[1] += 0.001461; scores[2] += -0.001413; break;
      case 8: scores[0] += -0.000664; scores[1] += 0.001906; scores[2] += -0.001242; break;
      case 9: scores[0] += 0.010408; scores[1] += -0.005816; scores[2] += -0.004592; break;
      case 10: scores[0] += 0.004425; scores[1] += -0.025913; scores[2] += 0.021488; break;
      case 11: scores[0] += 0.009634; scores[1] += -0.000084; scores[2] += -0.009549; break;
      case 12: scores[0] += -0.000917; scores[1] += 0.012406; scores[2] += -0.011489; break;
      case 13: scores[0] += -0.000241; scores[1] += 0.004310; scores[2] += -0.004069; break;
      case 14: scores[0] += -0.005771; scores[1] += 0.024388; scores[2] += -0.018617; break;
      case 15: scores[0] += -0.000541; scores[1] += 0.012620; scores[2] += -0.012079; break;
    }
  }

  // Tree 430 (depth=4)
  {
    const leafIdx = ((features[47] > 0.2666666805744171) << 0) | ((features[11] > 0.040833331644535065) << 1) | ((features[40] > 0.5) << 2) | ((features[34] > 0.05000000074505806) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006479; scores[1] += 0.004092; scores[2] += 0.002387; break;
      case 1: scores[0] += -0.005406; scores[1] += 0.008432; scores[2] += -0.003026; break;
      case 2: scores[0] += 0.002957; scores[1] += -0.009704; scores[2] += 0.006746; break;
      case 3: scores[0] += 0.003567; scores[1] += -0.002756; scores[2] += -0.000811; break;
      case 4: scores[0] += 0.018760; scores[1] += -0.013457; scores[2] += -0.005303; break;
      case 5: scores[0] += -0.015848; scores[1] += 0.016961; scores[2] += -0.001113; break;
      case 6: scores[0] += 0.004096; scores[1] += 0.021445; scores[2] += -0.025541; break;
      case 7: scores[0] += 0.000144; scores[1] += -0.000075; scores[2] += -0.000070; break;
      case 8: scores[0] += 0.008307; scores[1] += -0.003334; scores[2] += -0.004973; break;
      case 9: scores[0] += -0.004442; scores[1] += 0.006180; scores[2] += -0.001738; break;
      case 10: scores[0] += 0.001462; scores[1] += 0.001810; scores[2] += -0.003272; break;
      case 11: scores[0] += 0.002108; scores[1] += -0.001814; scores[2] += -0.000295; break;
      case 12: scores[0] += -0.023989; scores[1] += 0.014827; scores[2] += 0.009162; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.000819; scores[1] += -0.006075; scores[2] += 0.006894; break;
      case 15: scores[0] += 0.003372; scores[1] += -0.002994; scores[2] += -0.000378; break;
    }
  }

  // Tree 431 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[9] > 2.5) << 1) | ((features[44] > 0.25) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003819; scores[1] += -0.000877; scores[2] += -0.002942; break;
      case 1: scores[0] += 0.003746; scores[1] += 0.003364; scores[2] += -0.007110; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.005751; scores[1] += 0.009000; scores[2] += -0.014751; break;
      case 5: scores[0] += -0.012101; scores[1] += -0.011088; scores[2] += 0.023188; break;
      case 6: scores[0] += -0.004478; scores[1] += 0.002402; scores[2] += 0.002076; break;
      case 7: scores[0] += -0.000099; scores[1] += -0.003968; scores[2] += 0.004067; break;
      case 8: scores[0] += -0.009199; scores[1] += -0.003879; scores[2] += 0.013078; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.009148; scores[1] += 0.001860; scores[2] += 0.007288; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.003821; scores[1] += 0.001803; scores[2] += -0.005624; break;
      case 15: scores[0] += 0.000634; scores[1] += -0.003350; scores[2] += 0.002716; break;
    }
  }

  // Tree 432 (depth=4)
  {
    const leafIdx = ((features[44] > 0.550000011920929) << 0) | ((features[13] > 0.5604878067970276) << 1) | ((features[13] > 0.5617377758026123) << 2) | ((features[10] > 9.125) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004066; scores[1] += -0.001606; scores[2] += -0.002460; break;
      case 1: scores[0] += -0.000110; scores[1] += 0.000551; scores[2] += -0.000441; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.007794; scores[1] += 0.001180; scores[2] += 0.006614; break;
      case 7: scores[0] += -0.000162; scores[1] += 0.014111; scores[2] += -0.013949; break;
      case 8: scores[0] += 0.003826; scores[1] += -0.004359; scores[2] += 0.000533; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002465; scores[1] += 0.022110; scores[2] += -0.019645; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.004471; scores[1] += 0.002720; scores[2] += -0.007191; break;
      case 15: scores[0] += -0.001442; scores[1] += 0.002954; scores[2] += -0.001512; break;
    }
  }

  // Tree 433 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[40] > 0.5) << 1) | ((features[22] > 0.5) << 2) | ((features[13] > 0.47776681184768677) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001995; scores[1] += -0.003517; scores[2] += 0.005512; break;
      case 1: scores[0] += -0.002534; scores[1] += 0.009461; scores[2] += -0.006927; break;
      case 2: scores[0] += -0.001054; scores[1] += -0.000764; scores[2] += 0.001818; break;
      case 3: scores[0] += -0.000690; scores[1] += 0.005211; scores[2] += -0.004522; break;
      case 4: scores[0] += 0.002739; scores[1] += 0.004053; scores[2] += -0.006792; break;
      case 5: scores[0] += -0.000229; scores[1] += -0.005050; scores[2] += 0.005280; break;
      case 6: scores[0] += 0.014922; scores[1] += -0.002316; scores[2] += -0.012606; break;
      case 7: scores[0] += -0.000027; scores[1] += 0.023378; scores[2] += -0.023352; break;
      case 8: scores[0] += 0.007778; scores[1] += 0.001242; scores[2] += -0.009020; break;
      case 9: scores[0] += -0.000772; scores[1] += 0.001808; scores[2] += -0.001036; break;
      case 10: scores[0] += -0.010952; scores[1] += 0.011323; scores[2] += -0.000371; break;
      case 11: scores[0] += -0.001794; scores[1] += -0.011585; scores[2] += 0.013380; break;
      case 12: scores[0] += -0.014509; scores[1] += 0.010292; scores[2] += 0.004217; break;
      case 13: scores[0] += -0.001112; scores[1] += 0.009464; scores[2] += -0.008351; break;
      case 14: scores[0] += 0.006064; scores[1] += -0.025220; scores[2] += 0.019157; break;
      case 15: scores[0] += -0.000007; scores[1] += -0.001157; scores[2] += 0.001163; break;
    }
  }

  // Tree 434 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9298029541969299) << 0) | ((features[13] > 0.7776679992675781) << 1) | ((features[40] > 0.5) << 2) | ((features[43] > 0.17028985917568207) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000967; scores[1] += 0.000636; scores[2] += 0.000331; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.005230; scores[1] += -0.010813; scores[2] += 0.016043; break;
      case 3: scores[0] += 0.015866; scores[1] += 0.012725; scores[2] += -0.028591; break;
      case 4: scores[0] += 0.002212; scores[1] += 0.001136; scores[2] += -0.003348; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.005643; scores[1] += -0.014808; scores[2] += 0.009165; break;
      case 7: scores[0] += -0.010130; scores[1] += 0.011388; scores[2] += -0.001257; break;
      case 8: scores[0] += -0.008927; scores[1] += -0.001624; scores[2] += 0.010551; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000913; scores[1] += 0.021444; scores[2] += -0.022358; break;
      case 11: scores[0] += -0.000334; scores[1] += -0.004259; scores[2] += 0.004592; break;
      case 12: scores[0] += -0.004951; scores[1] += -0.005291; scores[2] += 0.010242; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.007433; scores[1] += -0.000481; scores[2] += 0.007914; break;
      case 15: scores[0] += -0.008912; scores[1] += -0.003646; scores[2] += 0.012558; break;
    }
  }

  // Tree 435 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[22] > 0.5) << 1) | ((features[10] > 5.7083330154418945) << 2) | ((features[13] > 0.8360214829444885) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003815; scores[1] += -0.007350; scores[2] += 0.003534; break;
      case 1: scores[0] += -0.001991; scores[1] += -0.005429; scores[2] += 0.007420; break;
      case 2: scores[0] += -0.003541; scores[1] += 0.005685; scores[2] += -0.002144; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000580; scores[1] += -0.001830; scores[2] += 0.001250; break;
      case 5: scores[0] += -0.005681; scores[1] += 0.017280; scores[2] += -0.011599; break;
      case 6: scores[0] += -0.007021; scores[1] += 0.005279; scores[2] += 0.001742; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.002764; scores[1] += 0.002805; scores[2] += -0.005569; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001341; scores[1] += 0.000045; scores[2] += 0.001296; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.020965; scores[1] += 0.005144; scores[2] += -0.026109; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 436 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 5.0833330154418945) << 1) | ((features[43] > 0.6651785373687744) << 2) | ((features[10] > 6.900000095367432) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000324; scores[1] += 0.000822; scores[2] += -0.000498; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.004408; scores[1] += 0.002890; scores[2] += 0.001518; break;
      case 3: scores[0] += -0.000420; scores[1] += -0.009490; scores[2] += 0.009910; break;
      case 4: scores[0] += 0.006321; scores[1] += 0.003986; scores[2] += -0.010307; break;
      case 5: scores[0] += -0.004165; scores[1] += 0.013227; scores[2] += -0.009062; break;
      case 6: scores[0] += -0.012820; scores[1] += -0.013202; scores[2] += 0.026023; break;
      case 7: scores[0] += 0.008551; scores[1] += -0.005209; scores[2] += -0.003342; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000640; scores[1] += -0.000182; scores[2] += -0.000458; break;
      case 11: scores[0] += 0.003229; scores[1] += -0.005429; scores[2] += 0.002200; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.005103; scores[1] += 0.007462; scores[2] += -0.012565; break;
      case 15: scores[0] += -0.011775; scores[1] += -0.010883; scores[2] += 0.022658; break;
    }
  }

  // Tree 437 (depth=4)
  {
    const leafIdx = ((features[44] > 0.15000000596046448) << 0) | ((features[10] > 9.583333969116211) << 1) | ((features[10] > 9.291666030883789) << 2) | ((features[13] > 0.44636017084121704) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007480; scores[1] += -0.029416; scores[2] += 0.021935; break;
      case 1: scores[0] += -0.006722; scores[1] += 0.007746; scores[2] += -0.001024; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.000887; scores[1] += -0.003344; scores[2] += 0.004231; break;
      case 6: scores[0] += 0.018364; scores[1] += 0.004726; scores[2] += -0.023090; break;
      case 7: scores[0] += -0.017853; scores[1] += 0.003497; scores[2] += 0.014356; break;
      case 8: scores[0] += -0.007725; scores[1] += 0.012199; scores[2] += -0.004474; break;
      case 9: scores[0] += -0.004302; scores[1] += -0.002657; scores[2] += 0.006958; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.042968; scores[1] += 0.016225; scores[2] += -0.059193; break;
      case 14: scores[0] += 0.002848; scores[1] += 0.006208; scores[2] += -0.009056; break;
      case 15: scores[0] += 0.000138; scores[1] += -0.002303; scores[2] += 0.002165; break;
    }
  }

  // Tree 438 (depth=4)
  {
    const leafIdx = ((features[10] > 7.900000095367432) << 0) | ((features[13] > 0.527046799659729) << 1) | ((features[44] > 0.15000000596046448) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.020662; scores[1] += -0.013710; scores[2] += -0.006952; break;
      case 1: scores[0] += 0.010134; scores[1] += -0.022775; scores[2] += 0.012641; break;
      case 2: scores[0] += 0.017816; scores[1] += -0.016952; scores[2] += -0.000865; break;
      case 3: scores[0] += -0.007429; scores[1] += 0.013591; scores[2] += -0.006163; break;
      case 4: scores[0] += 0.001233; scores[1] += -0.001540; scores[2] += 0.000307; break;
      case 5: scores[0] += -0.016721; scores[1] += 0.006189; scores[2] += 0.010532; break;
      case 6: scores[0] += 0.016519; scores[1] += 0.005571; scores[2] += -0.022090; break;
      case 7: scores[0] += 0.000506; scores[1] += 0.010201; scores[2] += -0.010706; break;
      case 8: scores[0] += -0.002449; scores[1] += -0.010829; scores[2] += 0.013278; break;
      case 9: scores[0] += -0.005612; scores[1] += 0.020312; scores[2] += -0.014700; break;
      case 10: scores[0] += -0.031827; scores[1] += 0.033534; scores[2] += -0.001707; break;
      case 11: scores[0] += 0.022024; scores[1] += -0.019618; scores[2] += -0.002406; break;
      case 12: scores[0] += -0.022359; scores[1] += 0.011675; scores[2] += 0.010685; break;
      case 13: scores[0] += 0.010525; scores[1] += 0.000332; scores[2] += -0.010858; break;
      case 14: scores[0] += -0.000620; scores[1] += 0.001865; scores[2] += -0.001245; break;
      case 15: scores[0] += 0.001816; scores[1] += -0.004970; scores[2] += 0.003154; break;
    }
  }

  // Tree 439 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[34] > 0.3500000238418579) << 1) | ((features[35] > 0.5) << 2) | ((features[10] > 11.833333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002473; scores[1] += 0.000988; scores[2] += -0.003462; break;
      case 1: scores[0] += 0.023456; scores[1] += -0.010682; scores[2] += -0.012774; break;
      case 2: scores[0] += -0.004447; scores[1] += -0.018684; scores[2] += 0.023131; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000793; scores[1] += 0.000300; scores[2] += 0.000493; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.004430; scores[1] += 0.021179; scores[2] += -0.016749; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.008847; scores[1] += -0.001787; scores[2] += 0.010634; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001008; scores[1] += -0.017655; scores[2] += 0.018663; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 440 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[10] > 5.366666793823242) << 1) | ((features[10] > 5.775000095367432) << 2) | ((features[10] > 7.550000190734863) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004225; scores[1] += 0.001513; scores[2] += -0.005738; break;
      case 1: scores[0] += 0.005536; scores[1] += 0.006470; scores[2] += -0.012005; break;
      case 2: scores[0] += -0.007546; scores[1] += -0.011911; scores[2] += 0.019457; break;
      case 3: scores[0] += -0.002569; scores[1] += -0.022865; scores[2] += 0.025433; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.003987; scores[1] += 0.002291; scores[2] += 0.001695; break;
      case 7: scores[0] += 0.000773; scores[1] += -0.014929; scores[2] += 0.014156; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.001217; scores[1] += -0.000084; scores[2] += -0.001133; break;
      case 15: scores[0] += -0.006033; scores[1] += 0.014662; scores[2] += -0.008629; break;
    }
  }

  // Tree 441 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[44] > 0.25) << 1) | ((features[11] > 0.1889880895614624) << 2) | ((features[3] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000788; scores[1] += -0.000970; scores[2] += 0.001758; break;
      case 1: scores[0] += 0.003994; scores[1] += 0.003081; scores[2] += -0.007074; break;
      case 2: scores[0] += 0.001310; scores[1] += -0.000916; scores[2] += -0.000393; break;
      case 3: scores[0] += -0.010499; scores[1] += -0.011864; scores[2] += 0.022363; break;
      case 4: scores[0] += 0.019191; scores[1] += -0.013049; scores[2] += -0.006142; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.007320; scores[1] += 0.042518; scores[2] += -0.035198; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000223; scores[1] += 0.002717; scores[2] += -0.002494; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.012342; scores[1] += 0.015963; scores[2] += -0.003621; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.003928; scores[1] += 0.007332; scores[2] += -0.011260; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.009610; scores[1] += -0.005054; scores[2] += 0.014664; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 442 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9183333516120911) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[43] > 0.19615384936332703) << 2) | ((features[43] > 0.21807065606117249) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001528; scores[1] += 0.000419; scores[2] += -0.001947; break;
      case 1: scores[0] += 0.000625; scores[1] += 0.002911; scores[2] += -0.003536; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.005501; scores[1] += -0.012174; scores[2] += 0.017674; break;
      case 5: scores[0] += 0.015617; scores[1] += -0.026856; scores[2] += 0.011238; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.016698; scores[1] += 0.009701; scores[2] += 0.006996; break;
      case 13: scores[0] += 0.002526; scores[1] += -0.008118; scores[2] += 0.005592; break;
      case 14: scores[0] += -0.002168; scores[1] += -0.008281; scores[2] += 0.010448; break;
      case 15: scores[0] += -0.000570; scores[1] += 0.000120; scores[2] += 0.000449; break;
    }
  }

  // Tree 443 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[13] > 0.5285947918891907) << 1) | ((features[34] > 0.05000000074505806) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003929; scores[1] += 0.000162; scores[2] += -0.004091; break;
      case 1: scores[0] += 0.000440; scores[1] += -0.020163; scores[2] += 0.019723; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.004438; scores[1] += 0.033314; scores[2] += -0.028875; break;
      case 4: scores[0] += -0.003772; scores[1] += -0.007707; scores[2] += 0.011479; break;
      case 5: scores[0] += 0.005602; scores[1] += -0.030757; scores[2] += 0.025154; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.024793; scores[1] += -0.039037; scores[2] += 0.014245; break;
      case 8: scores[0] += -0.015517; scores[1] += 0.004124; scores[2] += 0.011392; break;
      case 9: scores[0] += -0.005838; scores[1] += -0.018894; scores[2] += 0.024732; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.020681; scores[1] += -0.031599; scores[2] += 0.010918; break;
      case 12: scores[0] += 0.005394; scores[1] += 0.008532; scores[2] += -0.013926; break;
      case 13: scores[0] += 0.000104; scores[1] += 0.002618; scores[2] += -0.002722; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.002110; scores[1] += 0.002385; scores[2] += -0.000275; break;
    }
  }

  // Tree 444 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1889880895614624) << 0) | ((features[33] > 0.5) << 1) | ((features[29] > 0.5) << 2) | ((features[13] > 0.1026315838098526) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000925; scores[1] += 0.003921; scores[2] += -0.002996; break;
      case 1: scores[0] += 0.002849; scores[1] += 0.000607; scores[2] += -0.003456; break;
      case 2: scores[0] += -0.008085; scores[1] += -0.008085; scores[2] += 0.016170; break;
      case 3: scores[0] += -0.000908; scores[1] += -0.000988; scores[2] += 0.001896; break;
      case 4: scores[0] += -0.000272; scores[1] += -0.031070; scores[2] += 0.031343; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000805; scores[1] += -0.004847; scores[2] += 0.004043; break;
      case 9: scores[0] += 0.005742; scores[1] += 0.002501; scores[2] += -0.008243; break;
      case 10: scores[0] += -0.000589; scores[1] += -0.000116; scores[2] += 0.000705; break;
      case 11: scores[0] += -0.001904; scores[1] += 0.023869; scores[2] += -0.021965; break;
      case 12: scores[0] += -0.018954; scores[1] += 0.016176; scores[2] += 0.002778; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.002512; scores[1] += -0.011160; scores[2] += 0.008647; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 445 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9183333516120911) << 0) | ((features[13] > 0.9215384721755981) << 1) | ((features[11] > 0.028991596773266792) << 2) | ((features[11] > 0.049390241503715515) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.005793; scores[1] += 0.004339; scores[2] += 0.001455; break;
      case 1: scores[0] += 0.012368; scores[1] += -0.029540; scores[2] += 0.017172; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.002287; scores[1] += 0.002205; scores[2] += -0.004492; break;
      case 4: scores[0] += -0.016062; scores[1] += 0.003374; scores[2] += 0.012689; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.016928; scores[1] += -0.012453; scores[2] += 0.029381; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.005489; scores[1] += -0.004904; scores[2] += -0.000585; break;
      case 13: scores[0] += -0.014721; scores[1] += -0.011586; scores[2] += 0.026307; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.004486; scores[1] += 0.005372; scores[2] += -0.009858; break;
    }
  }

  // Tree 446 (depth=4)
  {
    const leafIdx = ((features[10] > 6.775000095367432) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[13] > 0.46291208267211914) << 2) | ((features[13] > 0.4767315983772278) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.013791; scores[1] += -0.010175; scores[2] += -0.003616; break;
      case 1: scores[0] += 0.009235; scores[1] += -0.013927; scores[2] += 0.004692; break;
      case 2: scores[0] += -0.008388; scores[1] += 0.005036; scores[2] += 0.003353; break;
      case 3: scores[0] += -0.008154; scores[1] += 0.005862; scores[2] += 0.002292; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.011000; scores[1] += -0.020711; scores[2] += 0.009711; break;
      case 7: scores[0] += 0.001629; scores[1] += -0.014943; scores[2] += 0.013314; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.020566; scores[1] += 0.022901; scores[2] += -0.002335; break;
      case 13: scores[0] += 0.004776; scores[1] += 0.004583; scores[2] += -0.009359; break;
      case 14: scores[0] += 0.000322; scores[1] += -0.001110; scores[2] += 0.000788; break;
      case 15: scores[0] += 0.000526; scores[1] += -0.001107; scores[2] += 0.000581; break;
    }
  }

  // Tree 447 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[10] > 5.900000095367432) << 1) | ((features[13] > 0.22474747896194458) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004688; scores[1] += 0.002555; scores[2] += -0.007243; break;
      case 1: scores[0] += -0.002280; scores[1] += -0.036395; scores[2] += 0.038675; break;
      case 2: scores[0] += 0.001310; scores[1] += 0.006215; scores[2] += -0.007525; break;
      case 3: scores[0] += -0.013582; scores[1] += -0.000884; scores[2] += 0.014466; break;
      case 4: scores[0] += -0.001545; scores[1] += 0.001214; scores[2] += 0.000331; break;
      case 5: scores[0] += 0.011548; scores[1] += 0.006626; scores[2] += -0.018174; break;
      case 6: scores[0] += -0.000074; scores[1] += -0.002051; scores[2] += 0.002125; break;
      case 7: scores[0] += -0.001761; scores[1] += -0.009520; scores[2] += 0.011282; break;
      case 8: scores[0] += -0.001314; scores[1] += -0.008488; scores[2] += 0.009802; break;
      case 9: scores[0] += -0.000098; scores[1] += 0.003294; scores[2] += -0.003196; break;
      case 10: scores[0] += -0.005346; scores[1] += -0.002121; scores[2] += 0.007467; break;
      case 11: scores[0] += -0.001923; scores[1] += 0.004223; scores[2] += -0.002300; break;
      case 12: scores[0] += -0.001333; scores[1] += 0.011222; scores[2] += -0.009888; break;
      case 13: scores[0] += -0.000060; scores[1] += 0.001458; scores[2] += -0.001398; break;
      case 14: scores[0] += 0.007103; scores[1] += 0.003841; scores[2] += -0.010945; break;
      case 15: scores[0] += -0.002362; scores[1] += 0.018977; scores[2] += -0.016615; break;
    }
  }

  // Tree 448 (depth=4)
  {
    const leafIdx = ((features[43] > 0.6651785373687744) << 0) | ((features[10] > 5.449999809265137) << 1) | ((features[10] > 5.775000095367432) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008869; scores[1] += 0.000050; scores[2] += -0.008919; break;
      case 1: scores[0] += 0.005977; scores[1] += 0.001259; scores[2] += -0.007235; break;
      case 2: scores[0] += -0.000263; scores[1] += 0.006068; scores[2] += -0.005806; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000297; scores[1] += -0.000860; scores[2] += 0.001157; break;
      case 7: scores[0] += -0.003753; scores[1] += -0.014584; scores[2] += 0.018337; break;
      case 8: scores[0] += -0.002978; scores[1] += 0.003407; scores[2] += -0.000429; break;
      case 9: scores[0] += -0.008629; scores[1] += 0.017769; scores[2] += -0.009139; break;
      case 10: scores[0] += -0.006474; scores[1] += -0.017738; scores[2] += 0.024211; break;
      case 11: scores[0] += -0.002557; scores[1] += -0.022476; scores[2] += 0.025032; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000357; scores[1] += 0.000737; scores[2] += -0.001094; break;
      case 15: scores[0] += -0.001998; scores[1] += 0.003895; scores[2] += -0.001897; break;
    }
  }

  // Tree 449 (depth=4)
  {
    const leafIdx = ((features[13] > 0.5345238447189331) << 0) | ((features[0] > 0.5) << 1) | ((features[10] > 11.833333969116211) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.026710; scores[1] += 0.014528; scores[2] += 0.012182; break;
      case 1: scores[0] += -0.002657; scores[1] += 0.002391; scores[2] += 0.000266; break;
      case 2: scores[0] += 0.017002; scores[1] += -0.014554; scores[2] += -0.002448; break;
      case 3: scores[0] += 0.019351; scores[1] += 0.008678; scores[2] += -0.028028; break;
      case 4: scores[0] += 0.006465; scores[1] += -0.019932; scores[2] += 0.013467; break;
      case 5: scores[0] += -0.000189; scores[1] += 0.002127; scores[2] += -0.001938; break;
      case 6: scores[0] += -0.018118; scores[1] += -0.009459; scores[2] += 0.027577; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.009827; scores[1] += -0.025774; scores[2] += 0.015947; break;
      case 9: scores[0] += 0.006904; scores[1] += 0.001138; scores[2] += -0.008042; break;
      case 10: scores[0] += 0.003487; scores[1] += -0.000491; scores[2] += -0.002996; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.005054; scores[1] += 0.007312; scores[2] += -0.012366; break;
      case 13: scores[0] += -0.016707; scores[1] += -0.000274; scores[2] += 0.016982; break;
      case 14: scores[0] += 0.013040; scores[1] += -0.002740; scores[2] += -0.010301; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 450 (depth=4)
  {
    const leafIdx = ((features[43] > 0.09545454382896423) << 0) | ((features[13] > 0.1026315838098526) << 1) | ((features[29] > 0.5) << 2) | ((features[11] > 0.050641026347875595) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002080; scores[1] += 0.000659; scores[2] += -0.002739; break;
      case 1: scores[0] += -0.000116; scores[1] += 0.004110; scores[2] += -0.003994; break;
      case 2: scores[0] += -0.005076; scores[1] += -0.003406; scores[2] += 0.008483; break;
      case 3: scores[0] += -0.000658; scores[1] += 0.001541; scores[2] += -0.000884; break;
      case 4: scores[0] += -0.000063; scores[1] += 0.002009; scores[2] += -0.001946; break;
      case 5: scores[0] += -0.000181; scores[1] += -0.033528; scores[2] += 0.033709; break;
      case 6: scores[0] += -0.008175; scores[1] += 0.031976; scores[2] += -0.023802; break;
      case 7: scores[0] += -0.002193; scores[1] += -0.015733; scores[2] += 0.017926; break;
      case 8: scores[0] += -0.007698; scores[1] += 0.009665; scores[2] += -0.001966; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.017780; scores[1] += -0.013726; scores[2] += -0.004053; break;
      case 11: scores[0] += -0.027635; scores[1] += 0.020421; scores[2] += 0.007213; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002751; scores[1] += -0.004165; scores[2] += 0.006917; break;
      case 15: scores[0] += -0.005757; scores[1] += -0.008257; scores[2] += 0.014013; break;
    }
  }

  // Tree 451 (depth=4)
  {
    const leafIdx = ((features[43] > 0.9285714626312256) << 0) | ((features[10] > 4.775000095367432) << 1) | ((features[44] > 0.25) << 2) | ((features[10] > 6.449999809265137) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004802; scores[1] += -0.004152; scores[2] += -0.000650; break;
      case 1: scores[0] += -0.016744; scores[1] += 0.003388; scores[2] += 0.013356; break;
      case 2: scores[0] += -0.012475; scores[1] += 0.011920; scores[2] += 0.000556; break;
      case 3: scores[0] += 0.012324; scores[1] += -0.006452; scores[2] += -0.005872; break;
      case 4: scores[0] += -0.007423; scores[1] += -0.007508; scores[2] += 0.014931; break;
      case 5: scores[0] += -0.003936; scores[1] += 0.018435; scores[2] += -0.014499; break;
      case 6: scores[0] += 0.014387; scores[1] += -0.002187; scores[2] += -0.012200; break;
      case 7: scores[0] += -0.006244; scores[1] += 0.001501; scores[2] += 0.004743; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.002063; scores[1] += -0.001835; scores[2] += -0.000228; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003186; scores[1] += 0.000968; scores[2] += 0.002218; break;
      case 15: scores[0] += -0.003648; scores[1] += -0.001870; scores[2] += 0.005518; break;
    }
  }

  // Tree 452 (depth=4)
  {
    const leafIdx = ((features[10] > 5.7083330154418945) << 0) | ((features[43] > 0.7663043737411499) << 1) | ((features[10] > 5.0833330154418945) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008681; scores[1] += -0.000043; scores[2] += -0.008639; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.005102; scores[1] += 0.001340; scores[2] += -0.006442; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000246; scores[1] += 0.005994; scores[2] += -0.005749; break;
      case 5: scores[0] += -0.000058; scores[1] += -0.000746; scores[2] += 0.000804; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.004397; scores[1] += -0.013942; scores[2] += 0.018340; break;
      case 8: scores[0] += -0.009189; scores[1] += 0.002602; scores[2] += 0.006587; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.007883; scores[1] += 0.015429; scores[2] += -0.007547; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.001201; scores[1] += -0.005064; scores[2] += 0.003863; break;
      case 13: scores[0] += -0.000072; scores[1] += 0.000325; scores[2] += -0.000253; break;
      case 14: scores[0] += -0.002513; scores[1] += -0.022060; scores[2] += 0.024573; break;
      case 15: scores[0] += -0.000865; scores[1] += 0.005844; scores[2] += -0.004979; break;
    }
  }

  // Tree 453 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[44] > 0.3500000238418579) << 1) | ((features[11] > 0.14760348200798035) << 2) | ((features[10] > 6.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.014602; scores[1] += 0.001999; scores[2] += 0.012603; break;
      case 1: scores[0] += 0.001951; scores[1] += -0.000118; scores[2] += -0.001832; break;
      case 2: scores[0] += 0.012483; scores[1] += 0.001190; scores[2] += -0.013673; break;
      case 3: scores[0] += -0.010067; scores[1] += 0.002214; scores[2] += 0.007853; break;
      case 4: scores[0] += -0.006496; scores[1] += 0.003728; scores[2] += 0.002768; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.020172; scores[1] += -0.015073; scores[2] += -0.005099; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.000792; scores[1] += -0.000948; scores[2] += 0.001739; break;
      case 9: scores[0] += -0.006171; scores[1] += 0.013226; scores[2] += -0.007055; break;
      case 10: scores[0] += -0.006095; scores[1] += 0.010216; scores[2] += -0.004122; break;
      case 11: scores[0] += 0.005919; scores[1] += -0.010318; scores[2] += 0.004399; break;
      case 12: scores[0] += 0.013146; scores[1] += 0.009124; scores[2] += -0.022270; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.004686; scores[1] += -0.035271; scores[2] += 0.039957; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 454 (depth=4)
  {
    const leafIdx = ((features[35] > 0.5) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[10] > 10.583333969116211) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005230; scores[1] += 0.000729; scores[2] += -0.005959; break;
      case 1: scores[0] += -0.025370; scores[1] += 0.000313; scores[2] += 0.025057; break;
      case 2: scores[0] += -0.001390; scores[1] += -0.024427; scores[2] += 0.025817; break;
      case 3: scores[0] += -0.000515; scores[1] += 0.032310; scores[2] += -0.031795; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.001299; scores[1] += 0.005432; scores[2] += -0.006730; break;
      case 7: scores[0] += -0.000682; scores[1] += -0.004409; scores[2] += 0.005091; break;
      case 8: scores[0] += -0.005786; scores[1] += -0.003741; scores[2] += 0.009527; break;
      case 9: scores[0] += 0.020127; scores[1] += 0.000278; scores[2] += -0.020405; break;
      case 10: scores[0] += -0.009357; scores[1] += 0.007953; scores[2] += 0.001404; break;
      case 11: scores[0] += -0.000764; scores[1] += 0.008617; scores[2] += -0.007852; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.003448; scores[1] += 0.003566; scores[2] += -0.000118; break;
      case 15: scores[0] += -0.001901; scores[1] += -0.001739; scores[2] += 0.003640; break;
    }
  }

  // Tree 455 (depth=4)
  {
    const leafIdx = ((features[43] > 0.15894736349582672) << 0) | ((features[13] > 0.16904762387275696) << 1) | ((features[10] > 9.708333969116211) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.010531; scores[1] += 0.010756; scores[2] += -0.000225; break;
      case 1: scores[0] += -0.001608; scores[1] += 0.009890; scores[2] += -0.008282; break;
      case 2: scores[0] += 0.007415; scores[1] += -0.005043; scores[2] += -0.002371; break;
      case 3: scores[0] += -0.010187; scores[1] += 0.001163; scores[2] += 0.009023; break;
      case 4: scores[0] += -0.024903; scores[1] += 0.005643; scores[2] += 0.019259; break;
      case 5: scores[0] += -0.000099; scores[1] += -0.040012; scores[2] += 0.040111; break;
      case 6: scores[0] += 0.008018; scores[1] += 0.004936; scores[2] += -0.012953; break;
      case 7: scores[0] += -0.018314; scores[1] += 0.010671; scores[2] += 0.007643; break;
      case 8: scores[0] += 0.008855; scores[1] += -0.032980; scores[2] += 0.024126; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.004240; scores[1] += 0.007208; scores[2] += -0.002968; break;
      case 11: scores[0] += -0.003193; scores[1] += 0.001997; scores[2] += 0.001196; break;
      case 12: scores[0] += 0.016599; scores[1] += 0.000636; scores[2] += -0.017235; break;
      case 13: scores[0] += -0.001987; scores[1] += 0.003974; scores[2] += -0.001987; break;
      case 14: scores[0] += 0.003165; scores[1] += 0.004705; scores[2] += -0.007871; break;
      case 15: scores[0] += 0.008537; scores[1] += -0.008786; scores[2] += 0.000249; break;
    }
  }

  // Tree 456 (depth=4)
  {
    const leafIdx = ((features[10] > 8.875) << 0) | ((features[10] > 8.416666030883789) << 1) | ((features[43] > 0.23904761672019958) << 2) | ((features[30] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003586; scores[1] += 0.000682; scores[2] += 0.002905; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.013245; scores[1] += 0.010136; scores[2] += -0.023381; break;
      case 3: scores[0] += 0.000092; scores[1] += -0.002343; scores[2] += 0.002252; break;
      case 4: scores[0] += -0.019072; scores[1] += 0.018522; scores[2] += 0.000549; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.022272; scores[1] += -0.008505; scores[2] += -0.013766; break;
      case 7: scores[0] += -0.006998; scores[1] += 0.022510; scores[2] += -0.015511; break;
      case 8: scores[0] += 0.007774; scores[1] += 0.003695; scores[2] += -0.011468; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.029807; scores[1] += 0.006146; scores[2] += 0.023661; break;
      case 11: scores[0] += 0.002478; scores[1] += -0.002066; scores[2] += -0.000411; break;
      case 12: scores[0] += -0.007489; scores[1] += -0.006490; scores[2] += 0.013979; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.024322; scores[1] += -0.019553; scores[2] += -0.004769; break;
      case 15: scores[0] += -0.006809; scores[1] += -0.001001; scores[2] += 0.007811; break;
    }
  }

  // Tree 457 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9743589758872986) << 0) | ((features[34] > 0.15000000596046448) << 1) | ((features[10] > 10.583333969116211) << 2) | ((features[43] > 0.2204861044883728) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000095; scores[1] += -0.000658; scores[2] += 0.000563; break;
      case 1: scores[0] += 0.003178; scores[1] += 0.012155; scores[2] += -0.015333; break;
      case 2: scores[0] += 0.016964; scores[1] += -0.014585; scores[2] += -0.002379; break;
      case 3: scores[0] += -0.032123; scores[1] += 0.014111; scores[2] += 0.018011; break;
      case 4: scores[0] += 0.009312; scores[1] += -0.006744; scores[2] += -0.002568; break;
      case 5: scores[0] += -0.003331; scores[1] += 0.005905; scores[2] += -0.002574; break;
      case 6: scores[0] += -0.019008; scores[1] += 0.031897; scores[2] += -0.012889; break;
      case 7: scores[0] += 0.031909; scores[1] += -0.016112; scores[2] += -0.015797; break;
      case 8: scores[0] += -0.022221; scores[1] += 0.006209; scores[2] += 0.016012; break;
      case 9: scores[0] += 0.002060; scores[1] += -0.003689; scores[2] += 0.001629; break;
      case 10: scores[0] += 0.000218; scores[1] += 0.020766; scores[2] += -0.020984; break;
      case 11: scores[0] += 0.017799; scores[1] += -0.007930; scores[2] += -0.009869; break;
      case 12: scores[0] += -0.002080; scores[1] += 0.007669; scores[2] += -0.005589; break;
      case 13: scores[0] += -0.020864; scores[1] += -0.002586; scores[2] += 0.023450; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.013134; scores[1] += -0.000963; scores[2] += 0.014097; break;
    }
  }

  // Tree 458 (depth=4)
  {
    const leafIdx = ((features[10] > 8.416666030883789) << 0) | ((features[44] > 0.15000000596046448) << 1) | ((features[10] > 7.7083330154418945) << 2) | ((features[13] > 0.029857397079467773) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.019481; scores[1] += -0.012644; scores[2] += -0.006837; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.022892; scores[1] += 0.018471; scores[2] += 0.004421; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.007164; scores[1] += -0.016378; scores[2] += 0.023542; break;
      case 5: scores[0] += 0.013500; scores[1] += -0.010030; scores[2] += -0.003469; break;
      case 6: scores[0] += 0.006029; scores[1] += -0.013038; scores[2] += 0.007009; break;
      case 7: scores[0] += -0.014054; scores[1] += 0.008261; scores[2] += 0.005793; break;
      case 8: scores[0] += -0.014225; scores[1] += 0.002931; scores[2] += 0.011294; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000417; scores[1] += -0.001557; scores[2] += 0.001140; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.012048; scores[1] += 0.016353; scores[2] += -0.004305; break;
      case 13: scores[0] += 0.009047; scores[1] += 0.009834; scores[2] += -0.018882; break;
      case 14: scores[0] += -0.002127; scores[1] += 0.002619; scores[2] += -0.000491; break;
      case 15: scores[0] += 0.002273; scores[1] += -0.001918; scores[2] += -0.000355; break;
    }
  }

  // Tree 459 (depth=4)
  {
    const leafIdx = ((features[43] > 0.3603896200656891) << 0) | ((features[22] > 0.5) << 1) | ((features[29] > 0.5) << 2) | ((features[10] > 6.633333206176758) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.005482; scores[1] += -0.005620; scores[2] += 0.000138; break;
      case 1: scores[0] += 0.000366; scores[1] += 0.004067; scores[2] += -0.004433; break;
      case 2: scores[0] += -0.008371; scores[1] += 0.006025; scores[2] += 0.002346; break;
      case 3: scores[0] += -0.000811; scores[1] += 0.021387; scores[2] += -0.020576; break;
      case 4: scores[0] += -0.005881; scores[1] += 0.006115; scores[2] += -0.000234; break;
      case 5: scores[0] += -0.000065; scores[1] += 0.002935; scores[2] += -0.002871; break;
      case 6: scores[0] += -0.004241; scores[1] += 0.007162; scores[2] += -0.002921; break;
      case 7: scores[0] += -0.000134; scores[1] += -0.001447; scores[2] += 0.001582; break;
      case 8: scores[0] += 0.000629; scores[1] += -0.000529; scores[2] += -0.000100; break;
      case 9: scores[0] += -0.004902; scores[1] += -0.001353; scores[2] += 0.006254; break;
      case 10: scores[0] += 0.005389; scores[1] += -0.003407; scores[2] += -0.001982; break;
      case 11: scores[0] += -0.000291; scores[1] += 0.005887; scores[2] += -0.005595; break;
      case 12: scores[0] += -0.007378; scores[1] += -0.001876; scores[2] += 0.009254; break;
      case 13: scores[0] += -0.000066; scores[1] += -0.003575; scores[2] += 0.003641; break;
      case 14: scores[0] += -0.000390; scores[1] += 0.006085; scores[2] += -0.005695; break;
      case 15: scores[0] += -0.000025; scores[1] += -0.003599; scores[2] += 0.003624; break;
    }
  }

  // Tree 460 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[23] > 0.5) << 1) | ((features[14] > 0.5) << 2) | ((features[13] > 0.5604878067970276) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.010477; scores[1] += -0.012411; scores[2] += 0.001934; break;
      case 1: scores[0] += -0.007217; scores[1] += 0.013359; scores[2] += -0.006141; break;
      case 2: scores[0] += -0.005982; scores[1] += 0.036495; scores[2] += -0.030513; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.004145; scores[1] += 0.005025; scores[2] += -0.000880; break;
      case 5: scores[0] += -0.000144; scores[1] += 0.002313; scores[2] += -0.002169; break;
      case 6: scores[0] += -0.001921; scores[1] += 0.014887; scores[2] += -0.012967; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.006749; scores[1] += 0.012908; scores[2] += -0.006159; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000381; scores[1] += 0.001361; scores[2] += -0.000980; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000904; scores[1] += -0.002043; scores[2] += 0.001139; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002730; scores[1] += 0.006599; scores[2] += -0.003870; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 461 (depth=4)
  {
    const leafIdx = ((features[13] > 0.42206478118896484) << 0) | ((features[13] > 0.43614131212234497) << 1) | ((features[10] > 6.224999904632568) << 2) | ((features[27] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.008372; scores[1] += -0.013435; scores[2] += 0.005064; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.003453; scores[1] += 0.010941; scores[2] += -0.007488; break;
      case 4: scores[0] += -0.004898; scores[1] += 0.006276; scores[2] += -0.001379; break;
      case 5: scores[0] += 0.000308; scores[1] += -0.024082; scores[2] += 0.023774; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.002064; scores[1] += -0.003579; scores[2] += 0.001515; break;
      case 8: scores[0] += -0.000011; scores[1] += -0.000797; scores[2] += 0.000807; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.001201; scores[1] += 0.001336; scores[2] += -0.002537; break;
      case 12: scores[0] += -0.000020; scores[1] += -0.002334; scores[2] += 0.002353; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.008095; scores[1] += -0.012671; scores[2] += 0.020765; break;
    }
  }

  // Tree 462 (depth=4)
  {
    const leafIdx = ((features[0] > 0.5) << 0) | ((features[10] > 6.099999904632568) << 1) | ((features[13] > 0.1644144058227539) << 2) | ((features[44] > 0.15000000596046448) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.012484; scores[1] += -0.008915; scores[2] += -0.003569; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.003093; scores[1] += -0.019191; scores[2] += 0.016098; break;
      case 3: scores[0] += 0.010558; scores[1] += -0.001304; scores[2] += -0.009254; break;
      case 4: scores[0] += -0.018351; scores[1] += 0.020652; scores[2] += -0.002301; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.002687; scores[1] += 0.002426; scores[2] += -0.005113; break;
      case 7: scores[0] += 0.005455; scores[1] += -0.002034; scores[2] += -0.003421; break;
      case 8: scores[0] += -0.008706; scores[1] += 0.002401; scores[2] += 0.006305; break;
      case 9: scores[0] += -0.003812; scores[1] += -0.014666; scores[2] += 0.018478; break;
      case 10: scores[0] += -0.023310; scores[1] += 0.016830; scores[2] += 0.006481; break;
      case 11: scores[0] += -0.014230; scores[1] += -0.000682; scores[2] += 0.014911; break;
      case 12: scores[0] += -0.001506; scores[1] += 0.002737; scores[2] += -0.001231; break;
      case 13: scores[0] += 0.024025; scores[1] += -0.014100; scores[2] += -0.009925; break;
      case 14: scores[0] += -0.003395; scores[1] += -0.001944; scores[2] += 0.005340; break;
      case 15: scores[0] += 0.032376; scores[1] += -0.006298; scores[2] += -0.026078; break;
    }
  }

  // Tree 463 (depth=4)
  {
    const leafIdx = ((features[13] > 0.8164982795715332) << 0) | ((features[13] > 0.9183333516120911) << 1) | ((features[43] > 0.6651785373687744) << 2) | ((features[10] > 12.833333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003084; scores[1] += 0.000318; scores[2] += 0.002766; break;
      case 1: scores[0] += 0.000774; scores[1] += 0.028037; scores[2] += -0.028812; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.006923; scores[1] += -0.006271; scores[2] += -0.000652; break;
      case 4: scores[0] += -0.000997; scores[1] += 0.008698; scores[2] += -0.007701; break;
      case 5: scores[0] += -0.002024; scores[1] += -0.006395; scores[2] += 0.008419; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.000454; scores[1] += -0.001926; scores[2] += 0.002380; break;
      case 8: scores[0] += 0.001115; scores[1] += 0.006471; scores[2] += -0.007586; break;
      case 9: scores[0] += 0.000045; scores[1] += -0.000037; scores[2] += -0.000008; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.014111; scores[1] += 0.005205; scores[2] += 0.008906; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.006281; scores[1] += 0.014124; scores[2] += -0.007843; break;
    }
  }

  // Tree 464 (depth=4)
  {
    const leafIdx = ((features[27] > 0.5) << 0) | ((features[10] > 5.366666793823242) << 1) | ((features[4] > 0.5) << 2) | ((features[10] > 6.449999809265137) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.007346; scores[1] += 0.009829; scores[2] += -0.002484; break;
      case 1: scores[0] += -0.001912; scores[1] += 0.006022; scores[2] += -0.004110; break;
      case 2: scores[0] += 0.008826; scores[1] += -0.001912; scores[2] += -0.006914; break;
      case 3: scores[0] += -0.000355; scores[1] += -0.009085; scores[2] += 0.009440; break;
      case 4: scores[0] += 0.008117; scores[1] += -0.002224; scores[2] += -0.005893; break;
      case 5: scores[0] += -0.003554; scores[1] += 0.007425; scores[2] += -0.003872; break;
      case 6: scores[0] += -0.017279; scores[1] += -0.000281; scores[2] += 0.017560; break;
      case 7: scores[0] += 0.008321; scores[1] += -0.004891; scores[2] += -0.003430; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.003669; scores[1] += 0.001415; scores[2] += 0.002254; break;
      case 11: scores[0] += 0.003124; scores[1] += -0.004349; scores[2] += 0.001225; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.006351; scores[1] += 0.002055; scores[2] += -0.008406; break;
      case 15: scores[0] += -0.011022; scores[1] += -0.010204; scores[2] += 0.021226; break;
    }
  }

  // Tree 465 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9023809432983398) << 0) | ((features[13] > 0.8973684310913086) << 1) | ((features[11] > 0.06155303120613098) << 2) | ((features[10] > 12.833333969116211) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.009172; scores[1] += 0.004773; scores[2] += 0.004400; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000859; scores[1] += -0.008329; scores[2] += 0.009188; break;
      case 3: scores[0] += 0.005776; scores[1] += 0.000839; scores[2] += -0.006615; break;
      case 4: scores[0] += 0.006991; scores[1] += -0.007830; scores[2] += 0.000839; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001376; scores[1] += 0.007056; scores[2] += -0.005679; break;
      case 7: scores[0] += 0.002097; scores[1] += -0.011483; scores[2] += 0.009386; break;
      case 8: scores[0] += 0.004776; scores[1] += 0.004379; scores[2] += -0.009154; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.020861; scores[1] += 0.012409; scores[2] += 0.008453; break;
      case 12: scores[0] += -0.002668; scores[1] += 0.005297; scores[2] += -0.002629; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.014637; scores[1] += -0.014478; scores[2] += -0.000158; break;
    }
  }

  // Tree 466 (depth=4)
  {
    const leafIdx = ((features[13] > 0.1449579894542694) << 0) | ((features[13] > 0.16904762387275696) << 1) | ((features[10] > 11.833333969116211) << 2) | ((features[4] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.017464; scores[1] += 0.011881; scores[2] += 0.005583; break;
      case 1: scores[0] += 0.003158; scores[1] += -0.009651; scores[2] += 0.006492; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.002592; scores[1] += -0.001069; scores[2] += -0.001523; break;
      case 4: scores[0] += -0.015459; scores[1] += 0.006542; scores[2] += 0.008917; break;
      case 5: scores[0] += -0.000100; scores[1] += -0.039547; scores[2] += 0.039647; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000067; scores[1] += -0.007186; scores[2] += 0.007119; break;
      case 8: scores[0] += 0.013334; scores[1] += -0.032982; scores[2] += 0.019649; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.005091; scores[1] += 0.000320; scores[2] += -0.005411; break;
      case 12: scores[0] += 0.008459; scores[1] += 0.005016; scores[2] += -0.013474; break;
      case 13: scores[0] += -0.001267; scores[1] += 0.003605; scores[2] += -0.002338; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.011381; scores[1] += 0.000465; scores[2] += 0.010916; break;
    }
  }

  // Tree 467 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[10] > 5.7083330154418945) << 1) | ((features[34] > 0.3500000238418579) << 2) | ((features[13] > 0.22474747896194458) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.002633; scores[1] += -0.006581; scores[2] += 0.003948; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.000232; scores[1] += 0.001598; scores[2] += -0.001366; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.000321; scores[1] += -0.012130; scores[2] += 0.012451; break;
      case 5: scores[0] += -0.001697; scores[1] += -0.005417; scores[2] += 0.007114; break;
      case 6: scores[0] += -0.009379; scores[1] += -0.023721; scores[2] += 0.033100; break;
      case 7: scores[0] += -0.004230; scores[1] += 0.015124; scores[2] += -0.010894; break;
      case 8: scores[0] += -0.002461; scores[1] += 0.001693; scores[2] += 0.000768; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000596; scores[1] += -0.000589; scores[2] += -0.000006; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.011414; scores[1] += 0.006316; scores[2] += -0.017730; break;
      case 13: scores[0] += -0.000083; scores[1] += 0.001283; scores[2] += -0.001201; break;
      case 14: scores[0] += -0.003705; scores[1] += 0.003135; scores[2] += 0.000570; break;
      case 15: scores[0] += -0.001362; scores[1] += 0.004827; scores[2] += -0.003465; break;
    }
  }

  // Tree 468 (depth=4)
  {
    const leafIdx = ((features[11] > 0.1889880895614624) << 0) | ((features[11] > 0.2124060094356537) << 1) | ((features[13] > 0.1449579894542694) << 2) | ((features[10] > 7.633333206176758) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.006378; scores[1] += 0.010975; scores[2] += -0.004598; break;
      case 1: scores[0] += -0.001369; scores[1] += 0.003813; scores[2] += -0.002445; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.000496; scores[1] += -0.008287; scores[2] += 0.008783; break;
      case 4: scores[0] += -0.000284; scores[1] += -0.006358; scores[2] += 0.006642; break;
      case 5: scores[0] += -0.002434; scores[1] += 0.024232; scores[2] += -0.021798; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.007407; scores[1] += 0.000028; scores[2] += 0.007378; break;
      case 8: scores[0] += -0.003803; scores[1] += 0.000572; scores[2] += 0.003231; break;
      case 9: scores[0] += -0.000581; scores[1] += -0.001019; scores[2] += 0.001599; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.002576; scores[1] += -0.001265; scores[2] += -0.001311; break;
      case 12: scores[0] += 0.000268; scores[1] += 0.001904; scores[2] += -0.002172; break;
      case 13: scores[0] += -0.005500; scores[1] += 0.023294; scores[2] += -0.017794; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.017472; scores[1] += -0.009613; scores[2] += -0.007859; break;
    }
  }

  // Tree 469 (depth=4)
  {
    const leafIdx = ((features[10] > 9.583333969116211) << 0) | ((features[10] > 9.291666030883789) << 1) | ((features[13] > 0.4721362292766571) << 2) | ((features[2] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000912; scores[1] += 0.001751; scores[2] += -0.002663; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.003517; scores[1] += -0.004754; scores[2] += 0.001238; break;
      case 3: scores[0] += 0.002742; scores[1] += -0.004102; scores[2] += 0.001360; break;
      case 4: scores[0] += -0.007127; scores[1] += 0.000180; scores[2] += 0.006947; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.012621; scores[1] += 0.028569; scores[2] += -0.041190; break;
      case 7: scores[0] += 0.011323; scores[1] += 0.008042; scores[2] += -0.019364; break;
      case 8: scores[0] += -0.005700; scores[1] += 0.007699; scores[2] += -0.001999; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.007100; scores[1] += -0.006029; scores[2] += -0.001071; break;
      case 11: scores[0] += 0.001445; scores[1] += -0.007151; scores[2] += 0.005706; break;
      case 12: scores[0] += 0.010628; scores[1] += -0.029949; scores[2] += 0.019320; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.037271; scores[1] += -0.007916; scores[2] += -0.029355; break;
      case 15: scores[0] += -0.011351; scores[1] += -0.003730; scores[2] += 0.015081; break;
    }
  }

  // Tree 470 (depth=4)
  {
    const leafIdx = ((features[31] > 0.5) << 0) | ((features[13] > 0.4721362292766571) << 1) | ((features[13] > 0.4749373495578766) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.002344; scores[1] += -0.002195; scores[2] += 0.004540; break;
      case 1: scores[0] += -0.002393; scores[1] += 0.008664; scores[2] += -0.006271; break;
      case 2: scores[0] += -0.001013; scores[1] += -0.021918; scores[2] += 0.022931; break;
      case 3: scores[0] += -0.000175; scores[1] += 0.000952; scores[2] += -0.000777; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000487; scores[1] += 0.002353; scores[2] += -0.002840; break;
      case 7: scores[0] += 0.002998; scores[1] += -0.001555; scores[2] += -0.001443; break;
      case 8: scores[0] += 0.019533; scores[1] += -0.003787; scores[2] += -0.015747; break;
      case 9: scores[0] += -0.004486; scores[1] += -0.003048; scores[2] += 0.007535; break;
      case 10: scores[0] += -0.000130; scores[1] += -0.003449; scores[2] += 0.003579; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.006065; scores[1] += -0.001749; scores[2] += 0.007814; break;
      case 15: scores[0] += -0.007423; scores[1] += 0.007737; scores[2] += -0.000314; break;
    }
  }

  // Tree 471 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[13] > 0.011904762126505375) << 1) | ((features[0] > 0.5) << 2) | ((features[13] > 0.3433035612106323) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000149; scores[1] += 0.001317; scores[2] += -0.001466; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.020239; scores[1] += 0.012899; scores[2] += 0.007340; break;
      case 3: scores[0] += -0.001788; scores[1] += -0.012751; scores[2] += 0.014539; break;
      case 4: scores[0] += 0.006231; scores[1] += -0.007243; scores[2] += 0.001012; break;
      case 5: scores[0] += -0.010448; scores[1] += -0.021501; scores[2] += 0.031949; break;
      case 6: scores[0] += 0.019700; scores[1] += -0.017555; scores[2] += -0.002145; break;
      case 7: scores[0] += -0.003139; scores[1] += 0.025611; scores[2] += -0.022473; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.002893; scores[1] += 0.000190; scores[2] += 0.002703; break;
      case 11: scores[0] += 0.004791; scores[1] += 0.001216; scores[2] += -0.006007; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.020711; scores[1] += -0.004464; scores[2] += -0.016247; break;
      case 15: scores[0] += -0.000329; scores[1] += 0.001047; scores[2] += -0.000718; break;
    }
  }

  // Tree 472 (depth=4)
  {
    const leafIdx = ((features[43] > 0.36602872610092163) << 0) | ((features[13] > 0.42206478118896484) << 1) | ((features[13] > 0.4202037453651428) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.008401; scores[1] += 0.005782; scores[2] += 0.002619; break;
      case 1: scores[0] += -0.001200; scores[1] += 0.009963; scores[2] += -0.008763; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += -0.000013; scores[1] += 0.024823; scores[2] += -0.024810; break;
      case 6: scores[0] += -0.002204; scores[1] += -0.002325; scores[2] += 0.004529; break;
      case 7: scores[0] += -0.002426; scores[1] += 0.000187; scores[2] += 0.002239; break;
      case 8: scores[0] += 0.010288; scores[1] += -0.014209; scores[2] += 0.003921; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.001070; scores[1] += 0.013347; scores[2] += -0.012277; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.021443; scores[1] += -0.005767; scores[2] += -0.015676; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 473 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9298029541969299) << 0) | ((features[13] > 0.9215384721755981) << 1) | ((features[13] > 0.9384469985961914) << 2) | ((features[43] > 0.1889880895614624) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000415; scores[1] += 0.000851; scores[2] += -0.000436; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.004203; scores[1] += 0.008290; scores[2] += -0.004087; break;
      case 3: scores[0] += 0.040633; scores[1] += -0.036517; scores[2] += -0.004116; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.003583; scores[1] += 0.011752; scores[2] += -0.015335; break;
      case 8: scores[0] += -0.006591; scores[1] += -0.002128; scores[2] += 0.008719; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.006779; scores[1] += 0.025570; scores[2] += -0.018790; break;
      case 11: scores[0] += -0.000586; scores[1] += 0.009883; scores[2] += -0.009297; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.001754; scores[1] += -0.005233; scores[2] += 0.006987; break;
    }
  }

  // Tree 474 (depth=4)
  {
    const leafIdx = ((features[43] > 0.7663043737411499) << 0) | ((features[10] > 9.291666030883789) << 1) | ((features[10] > 10.125) << 2) | ((features[10] > 10.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003041; scores[1] += 0.001077; scores[2] += 0.001964; break;
      case 1: scores[0] += -0.002579; scores[1] += 0.005074; scores[2] += -0.002495; break;
      case 2: scores[0] += 0.012241; scores[1] += -0.006904; scores[2] += -0.005337; break;
      case 3: scores[0] += 0.024338; scores[1] += -0.014311; scores[2] += -0.010028; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001066; scores[1] += -0.021695; scores[2] += 0.022761; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000500; scores[1] += 0.004240; scores[2] += -0.004740; break;
      case 15: scores[0] += -0.016485; scores[1] += -0.002125; scores[2] += 0.018610; break;
    }
  }

  // Tree 475 (depth=4)
  {
    const leafIdx = ((features[28] > 0.5) << 0) | ((features[22] > 0.5) << 1) | ((features[44] > 0.25) << 2) | ((features[35] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001562; scores[1] += -0.004162; scores[2] += 0.002600; break;
      case 1: scores[0] += -0.002008; scores[1] += 0.022037; scores[2] += -0.020029; break;
      case 2: scores[0] += -0.004743; scores[1] += 0.002801; scores[2] += 0.001942; break;
      case 3: scores[0] += -0.000150; scores[1] += 0.005707; scores[2] += -0.005557; break;
      case 4: scores[0] += -0.001203; scores[1] += 0.001760; scores[2] += -0.000557; break;
      case 5: scores[0] += -0.005791; scores[1] += 0.028271; scores[2] += -0.022480; break;
      case 6: scores[0] += 0.001302; scores[1] += -0.005290; scores[2] += 0.003988; break;
      case 7: scores[0] += -0.000413; scores[1] += 0.011501; scores[2] += -0.011089; break;
      case 8: scores[0] += -0.010377; scores[1] += -0.005026; scores[2] += 0.015404; break;
      case 9: scores[0] += -0.000011; scores[1] += 0.001848; scores[2] += -0.001836; break;
      case 10: scores[0] += 0.012434; scores[1] += 0.003243; scores[2] += -0.015676; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000914; scores[1] += -0.005882; scores[2] += 0.004968; break;
      case 13: scores[0] += -0.000524; scores[1] += 0.009328; scores[2] += -0.008804; break;
      case 14: scores[0] += -0.005200; scores[1] += 0.016043; scores[2] += -0.010843; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 476 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[43] > 0.9285714626312256) << 1) | ((features[43] > 0.6651785373687744) << 2) | ((features[10] > 5.0833330154418945) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.000667; scores[1] += -0.000116; scores[2] += 0.000783; break;
      case 1: scores[0] += -0.000084; scores[1] += 0.001402; scores[2] += -0.001318; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.001923; scores[1] += -0.005962; scores[2] += 0.007885; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.006746; scores[1] += 0.009143; scores[2] += -0.015888; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000710; scores[1] += -0.000567; scores[2] += -0.000143; break;
      case 9: scores[0] += -0.006807; scores[1] += 0.012548; scores[2] += -0.005741; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000934; scores[1] += 0.009219; scores[2] += -0.008285; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.007453; scores[1] += -0.008477; scores[2] += 0.015930; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 477 (depth=4)
  {
    const leafIdx = ((features[13] > 0.9354166984558105) << 0) | ((features[13] > 0.9384469985961914) << 1) | ((features[13] > 0.9215384721755981) << 2) | ((features[13] > 0.9183333516120911) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001428; scores[1] += 0.001197; scores[2] += 0.000231; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.001684; scores[1] += -0.033852; scores[2] += 0.035536; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.011951; scores[1] += 0.017106; scores[2] += -0.029057; break;
      case 13: scores[0] += 0.027083; scores[1] += -0.026079; scores[2] += -0.001004; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += -0.001630; scores[1] += 0.000553; scores[2] += 0.001077; break;
    }
  }

  // Tree 478 (depth=4)
  {
    const leafIdx = ((features[10] > 6.2916669845581055) << 0) | ((features[43] > 0.6651785373687744) << 1) | ((features[13] > 0.8550419807434082) << 2) | ((features[44] > 0.3500000238418579) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001150; scores[1] += -0.007862; scores[2] += 0.009012; break;
      case 1: scores[0] += 0.002542; scores[1] += -0.002146; scores[2] += -0.000395; break;
      case 2: scores[0] += -0.000126; scores[1] += 0.002791; scores[2] += -0.002665; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.016968; scores[1] += 0.024066; scores[2] += -0.007098; break;
      case 5: scores[0] += 0.001106; scores[1] += 0.001134; scores[2] += -0.002240; break;
      case 6: scores[0] += 0.002214; scores[1] += -0.001212; scores[2] += -0.001002; break;
      case 7: scores[0] += -0.004922; scores[1] += 0.013689; scores[2] += -0.008767; break;
      case 8: scores[0] += 0.015161; scores[1] += 0.004573; scores[2] += -0.019735; break;
      case 9: scores[0] += -0.023348; scores[1] += 0.011644; scores[2] += 0.011704; break;
      case 10: scores[0] += -0.001743; scores[1] += -0.006702; scores[2] += 0.008445; break;
      case 11: scores[0] += -0.000273; scores[1] += 0.006010; scores[2] += -0.005737; break;
      case 12: scores[0] += 0.011420; scores[1] += -0.026863; scores[2] += 0.015443; break;
      case 13: scores[0] += 0.012279; scores[1] += 0.010390; scores[2] += -0.022669; break;
      case 14: scores[0] += -0.008185; scores[1] += 0.012534; scores[2] += -0.004350; break;
      case 15: scores[0] += 0.002924; scores[1] += -0.014811; scores[2] += 0.011887; break;
    }
  }

  // Tree 479 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[27] > 0.5) << 1) | ((features[13] > 0.5166851878166199) << 2) | ((features[10] > 4.2916669845581055) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.003343; scores[1] += 0.003416; scores[2] += -0.006759; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.015129; scores[1] += 0.007450; scores[2] += 0.007679; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001430; scores[1] += 0.005483; scores[2] += -0.004053; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.003529; scores[1] += 0.000662; scores[2] += 0.002867; break;
      case 9: scores[0] += 0.021135; scores[1] += -0.008397; scores[2] += -0.012737; break;
      case 10: scores[0] += -0.000029; scores[1] += -0.002895; scores[2] += 0.002924; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.003017; scores[1] += 0.002153; scores[2] += -0.005170; break;
      case 13: scores[0] += 0.005142; scores[1] += -0.003155; scores[2] += -0.001987; break;
      case 14: scores[0] += -0.004888; scores[1] += -0.012385; scores[2] += 0.017274; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 480 (depth=4)
  {
    const leafIdx = ((features[34] > 0.44999998807907104) << 0) | ((features[13] > 0.8550419807434082) << 1) | ((features[13] > 0.9183333516120911) << 2) | ((features[13] > 0.9215384721755981) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000542; scores[1] += -0.000972; scores[2] += 0.000430; break;
      case 1: scores[0] += -0.006793; scores[1] += 0.012336; scores[2] += -0.005542; break;
      case 2: scores[0] += -0.010632; scores[1] += 0.028975; scores[2] += -0.018343; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.002115; scores[1] += -0.031862; scores[2] += 0.033977; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.001910; scores[1] += 0.001294; scores[2] += -0.003204; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 481 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[10] > 7.7083330154418945) << 1) | ((features[11] > 0.2679487466812134) << 2) | ((features[10] > 10.416666030883789) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.004190; scores[1] += 0.004235; scores[2] += -0.000045; break;
      case 1: scores[0] += 0.002643; scores[1] += -0.002550; scores[2] += -0.000093; break;
      case 2: scores[0] += 0.004057; scores[1] += -0.005217; scores[2] += 0.001160; break;
      case 3: scores[0] += 0.003097; scores[1] += 0.016389; scores[2] += -0.019486; break;
      case 4: scores[0] += -0.005003; scores[1] += -0.017521; scores[2] += 0.022524; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001571; scores[1] += -0.004372; scores[2] += 0.005943; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000062; scores[1] += 0.004137; scores[2] += -0.004199; break;
      case 11: scores[0] += -0.016315; scores[1] += -0.001203; scores[2] += 0.017518; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.001820; scores[1] += -0.000895; scores[2] += -0.000925; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 482 (depth=4)
  {
    const leafIdx = ((features[11] > 0.03637566417455673) << 0) | ((features[11] > 0.035098522901535034) << 1) | ((features[47] > 0.2666666805744171) << 2) | ((features[43] > 0.15894736349582672) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.004140; scores[1] += -0.000000; scores[2] += -0.004139; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.001106; scores[1] += 0.007461; scores[2] += -0.006355; break;
      case 3: scores[0] += 0.003818; scores[1] += -0.003828; scores[2] += 0.000010; break;
      case 4: scores[0] += -0.013957; scores[1] += 0.016933; scores[2] += -0.002975; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.008308; scores[1] += -0.007040; scores[2] += -0.001269; break;
      case 8: scores[0] += -0.001536; scores[1] += -0.003385; scores[2] += 0.004921; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.000026; scores[1] += -0.000962; scores[2] += 0.000988; break;
      case 11: scores[0] += -0.025042; scores[1] += 0.014522; scores[2] += 0.010520; break;
      case 12: scores[0] += -0.002279; scores[1] += 0.004793; scores[2] += -0.002514; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 483 (depth=4)
  {
    const leafIdx = ((features[13] > 0.46291208267211914) << 0) | ((features[0] > 0.5) << 1) | ((features[10] > 9.416666030883789) << 2) | ((features[11] > 0.0635080635547638) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003662; scores[1] += 0.003922; scores[2] += -0.000260; break;
      case 1: scores[0] += -0.005422; scores[1] += -0.000452; scores[2] += 0.005874; break;
      case 2: scores[0] += -0.005791; scores[1] += 0.014379; scores[2] += -0.008588; break;
      case 3: scores[0] += -0.009368; scores[1] += 0.006945; scores[2] += 0.002423; break;
      case 4: scores[0] += -0.007400; scores[1] += -0.000143; scores[2] += 0.007543; break;
      case 5: scores[0] += 0.006480; scores[1] += 0.002187; scores[2] += -0.008667; break;
      case 6: scores[0] += 0.022528; scores[1] += -0.000704; scores[2] += -0.021824; break;
      case 7: scores[0] += 0.018899; scores[1] += -0.004639; scores[2] += -0.014260; break;
      case 8: scores[0] += -0.007663; scores[1] += 0.023370; scores[2] += -0.015707; break;
      case 9: scores[0] += -0.000382; scores[1] += -0.002953; scores[2] += 0.003335; break;
      case 10: scores[0] += 0.012818; scores[1] += -0.022256; scores[2] += 0.009439; break;
      case 11: scores[0] += 0.037827; scores[1] += 0.000163; scores[2] += -0.037991; break;
      case 12: scores[0] += 0.015603; scores[1] += -0.010917; scores[2] += -0.004687; break;
      case 13: scores[0] += -0.011919; scores[1] += 0.001687; scores[2] += 0.010232; break;
      case 14: scores[0] += -0.008567; scores[1] += 0.004149; scores[2] += 0.004419; break;
      case 15: scores[0] += -0.016800; scores[1] += -0.001816; scores[2] += 0.018617; break;
    }
  }

  // Tree 484 (depth=4)
  {
    const leafIdx = ((features[15] > 0.5) << 0) | ((features[10] > 7.550000190734863) << 1) | ((features[31] > 0.5) << 2) | ((features[13] > 0.9148551225662231) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.008761; scores[1] += -0.000835; scores[2] += 0.009596; break;
      case 1: scores[0] += 0.021837; scores[1] += -0.009271; scores[2] += -0.012566; break;
      case 2: scores[0] += -0.003257; scores[1] += 0.003578; scores[2] += -0.000321; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.011387; scores[1] += 0.016213; scores[2] += -0.004825; break;
      case 5: scores[0] += 0.000572; scores[1] += -0.000396; scores[2] += -0.000176; break;
      case 6: scores[0] += 0.004512; scores[1] += -0.002966; scores[2] += -0.001546; break;
      case 7: scores[0] += 0.002938; scores[1] += -0.001388; scores[2] += -0.001550; break;
      case 8: scores[0] += 0.004217; scores[1] += -0.000982; scores[2] += -0.003235; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.001746; scores[1] += 0.004636; scores[2] += -0.006382; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.002536; scores[1] += 0.002706; scores[2] += -0.000170; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000346; scores[1] += -0.008897; scores[2] += 0.008551; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 485 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[10] > 9.291666030883789) << 1) | ((features[13] > 0.02817460335791111) << 2) | ((features[11] > 0.012500000186264515) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.007027; scores[1] += -0.012858; scores[2] += 0.019885; break;
      case 1: scores[0] += 0.012007; scores[1] += 0.033216; scores[2] += -0.045223; break;
      case 2: scores[0] += 0.018848; scores[1] += 0.034187; scores[2] += -0.053035; break;
      case 3: scores[0] += -0.005159; scores[1] += -0.020135; scores[2] += 0.025294; break;
      case 4: scores[0] += 0.003727; scores[1] += 0.001007; scores[2] += -0.004734; break;
      case 5: scores[0] += -0.014472; scores[1] += -0.001396; scores[2] += 0.015869; break;
      case 6: scores[0] += -0.000601; scores[1] += -0.000825; scores[2] += 0.001426; break;
      case 7: scores[0] += -0.005302; scores[1] += 0.047984; scores[2] += -0.042682; break;
      case 8: scores[0] += 0.005748; scores[1] += 0.002078; scores[2] += -0.007826; break;
      case 9: scores[0] += -0.008788; scores[1] += 0.004211; scores[2] += 0.004577; break;
      case 10: scores[0] += -0.002551; scores[1] += -0.005727; scores[2] += 0.008278; break;
      case 11: scores[0] += -0.003755; scores[1] += -0.008240; scores[2] += 0.011996; break;
      case 12: scores[0] += -0.018040; scores[1] += 0.008895; scores[2] += 0.009145; break;
      case 13: scores[0] += 0.003069; scores[1] += -0.000256; scores[2] += -0.002813; break;
      case 14: scores[0] += 0.006332; scores[1] += -0.007999; scores[2] += 0.001667; break;
      case 15: scores[0] += 0.018036; scores[1] += -0.024341; scores[2] += 0.006304; break;
    }
  }

  // Tree 486 (depth=4)
  {
    const leafIdx = ((features[13] > 0.12310606241226196) << 0) | ((features[44] > 0.25) << 1) | ((features[23] > 0.5) << 2) | ((features[10] > 6.633333206176758) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.007175; scores[1] += -0.021964; scores[2] += 0.014789; break;
      case 1: scores[0] += 0.001014; scores[1] += 0.010162; scores[2] += -0.011176; break;
      case 2: scores[0] += -0.011769; scores[1] += 0.017715; scores[2] += -0.005947; break;
      case 3: scores[0] += 0.008323; scores[1] += -0.006957; scores[2] += -0.001366; break;
      case 4: scores[0] += -0.000645; scores[1] += 0.013024; scores[2] += -0.012379; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.001611; scores[1] += 0.011588; scores[2] += -0.009978; break;
      case 7: scores[0] += -0.000638; scores[1] += 0.007856; scores[2] += -0.007218; break;
      case 8: scores[0] += 0.003127; scores[1] += -0.006920; scores[2] += 0.003793; break;
      case 9: scores[0] += 0.003172; scores[1] += -0.002129; scores[2] += -0.001044; break;
      case 10: scores[0] += -0.004803; scores[1] += 0.004936; scores[2] += -0.000133; break;
      case 11: scores[0] += -0.001938; scores[1] += -0.002898; scores[2] += 0.004837; break;
      case 12: scores[0] += -0.001413; scores[1] += 0.015093; scores[2] += -0.013679; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.001955; scores[1] += 0.023723; scores[2] += -0.021768; break;
      case 15: scores[0] += -0.004567; scores[1] += 0.027679; scores[2] += -0.023111; break;
    }
  }

  // Tree 487 (depth=4)
  {
    const leafIdx = ((features[34] > 0.3500000238418579) << 0) | ((features[11] > 0.07846154272556305) << 1) | ((features[11] > 0.08054053783416748) << 2) | ((features[29] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001540; scores[1] += 0.000249; scores[2] += -0.001789; break;
      case 1: scores[0] += 0.002299; scores[1] += -0.014505; scores[2] += 0.012205; break;
      case 2: scores[0] += 0.002218; scores[1] += -0.020285; scores[2] += 0.018067; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.001165; scores[1] += 0.004100; scores[2] += -0.005265; break;
      case 7: scores[0] += -0.005363; scores[1] += -0.001007; scores[2] += 0.006370; break;
      case 8: scores[0] += -0.010130; scores[1] += 0.006858; scores[2] += 0.003273; break;
      case 9: scores[0] += -0.004760; scores[1] += -0.001714; scores[2] += 0.006474; break;
      case 10: scores[0] += 0.018862; scores[1] += -0.002754; scores[2] += -0.016108; break;
      case 11: scores[0] += -0.003886; scores[1] += 0.018507; scores[2] += -0.014620; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.016495; scores[1] += -0.012807; scores[2] += 0.029302; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 488 (depth=4)
  {
    const leafIdx = ((features[10] > 7.7083330154418945) << 0) | ((features[10] > 7.633333206176758) << 1) | ((features[11] > 0.12771739065647125) << 2) | ((features[14] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.026516; scores[1] += -0.010095; scores[2] += -0.016421; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += -0.001665; scores[1] += 0.001943; scores[2] += -0.000278; break;
      case 3: scores[0] += -0.007382; scores[1] += 0.001688; scores[2] += 0.005693; break;
      case 4: scores[0] += 0.011106; scores[1] += -0.029376; scores[2] += 0.018270; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.000843; scores[1] += 0.019072; scores[2] += -0.018229; break;
      case 7: scores[0] += -0.002448; scores[1] += -0.000444; scores[2] += 0.002892; break;
      case 8: scores[0] += -0.007946; scores[1] += 0.001933; scores[2] += 0.006013; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.009023; scores[1] += 0.025020; scores[2] += -0.015997; break;
      case 11: scores[0] += 0.003563; scores[1] += -0.000877; scores[2] += -0.002685; break;
      case 12: scores[0] += -0.013475; scores[1] += 0.014590; scores[2] += -0.001115; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.001659; scores[1] += -0.001570; scores[2] += 0.003229; break;
      case 15: scores[0] += 0.027823; scores[1] += -0.010871; scores[2] += -0.016953; break;
    }
  }

  // Tree 489 (depth=4)
  {
    const leafIdx = ((features[43] > 0.23904761672019958) << 0) | ((features[43] > 0.2886904776096344) << 1) | ((features[13] > 0.9298029541969299) << 2) | ((features[13] > 0.9183333516120911) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000747; scores[1] += 0.000861; scores[2] += -0.001608; break;
      case 1: scores[0] += -0.011500; scores[1] += -0.006501; scores[2] += 0.018000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += -0.011503; scores[1] += 0.006990; scores[2] += 0.004513; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 8: scores[0] += -0.005221; scores[1] += -0.016898; scores[2] += 0.022119; break;
      case 9: scores[0] += -0.004488; scores[1] += 0.012897; scores[2] += -0.008409; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.000650; scores[1] += 0.007581; scores[2] += -0.006931; break;
      case 12: scores[0] += 0.002589; scores[1] += 0.003328; scores[2] += -0.005917; break;
      case 13: scores[0] += -0.011083; scores[1] += -0.011815; scores[2] += 0.022898; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.006393; scores[1] += -0.000264; scores[2] += -0.006130; break;
    }
  }

  // Tree 490 (depth=4)
  {
    const leafIdx = ((features[10] > 9.708333969116211) << 0) | ((features[10] > 10.833333969116211) << 1) | ((features[34] > 0.15000000596046448) << 2) | ((features[13] > 0.12310606241226196) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.012428; scores[1] += 0.011770; scores[2] += 0.000658; break;
      case 1: scores[0] += 0.002043; scores[1] += -0.017852; scores[2] += 0.015809; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.003159; scores[1] += 0.004198; scores[2] += -0.007356; break;
      case 4: scores[0] += 0.017816; scores[1] += -0.008399; scores[2] += -0.009416; break;
      case 5: scores[0] += -0.004378; scores[1] += 0.009525; scores[2] += -0.005148; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += -0.009858; scores[1] += 0.006243; scores[2] += 0.003615; break;
      case 8: scores[0] += -0.002549; scores[1] += -0.001497; scores[2] += 0.004046; break;
      case 9: scores[0] += 0.019317; scores[1] += -0.005873; scores[2] += -0.013444; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += -0.007739; scores[1] += 0.001453; scores[2] += 0.006286; break;
      case 12: scores[0] += 0.004152; scores[1] += 0.002115; scores[2] += -0.006266; break;
      case 13: scores[0] += -0.003601; scores[1] += 0.006431; scores[2] += -0.002830; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.011873; scores[1] += 0.000170; scores[2] += -0.012044; break;
    }
  }

  // Tree 491 (depth=4)
  {
    const leafIdx = ((features[10] > 10.833333969116211) << 0) | ((features[9] > 2.5) << 1) | ((features[22] > 0.5) << 2) | ((features[11] > 0.05971479415893555) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000241; scores[1] += -0.001257; scores[2] += 0.001016; break;
      case 1: scores[0] += -0.009694; scores[1] += -0.006214; scores[2] += 0.015908; break;
      case 2: scores[0] += 0.004810; scores[1] += -0.000369; scores[2] += -0.004442; break;
      case 3: scores[0] += 0.006808; scores[1] += -0.007465; scores[2] += 0.000657; break;
      case 4: scores[0] += 0.009817; scores[1] += -0.006447; scores[2] += -0.003370; break;
      case 5: scores[0] += -0.002196; scores[1] += 0.024936; scores[2] += -0.022740; break;
      case 6: scores[0] += -0.020961; scores[1] += 0.012644; scores[2] += 0.008318; break;
      case 7: scores[0] += 0.008549; scores[1] += -0.014259; scores[2] += 0.005710; break;
      case 8: scores[0] += 0.001628; scores[1] += 0.000589; scores[2] += -0.002217; break;
      case 9: scores[0] += 0.015608; scores[1] += -0.027171; scores[2] += 0.011563; break;
      case 10: scores[0] += 0.002607; scores[1] += -0.008066; scores[2] += 0.005459; break;
      case 11: scores[0] += -0.034701; scores[1] += 0.045043; scores[2] += -0.010342; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.008408; scores[1] += -0.006422; scores[2] += -0.001986; break;
      case 15: scores[0] += -0.006039; scores[1] += -0.004040; scores[2] += 0.010078; break;
    }
  }

  // Tree 492 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8516483306884766) << 0) | ((features[43] > 0.8321678638458252) << 1) | ((features[43] > 0.7663043737411499) << 2) | ((features[44] > 0.25) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.001821; scores[1] += -0.001313; scores[2] += -0.000508; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 7: scores[0] += 0.001219; scores[1] += -0.004490; scores[2] += 0.003271; break;
      case 8: scores[0] += -0.001426; scores[1] += 0.001102; scores[2] += 0.000324; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.000229; scores[1] += 0.015070; scores[2] += -0.014841; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.001159; scores[1] += -0.013737; scores[2] += 0.014896; break;
      case 15: scores[0] += -0.003816; scores[1] += 0.006808; scores[2] += -0.002991; break;
    }
  }

  // Tree 493 (depth=4)
  {
    const leafIdx = ((features[43] > 0.8321678638458252) << 0) | ((features[44] > 0.25) << 1) | ((features[10] > 8.875) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.013284; scores[1] += -0.001124; scores[2] += 0.014408; break;
      case 1: scores[0] += 0.001088; scores[1] += -0.004134; scores[2] += 0.003046; break;
      case 2: scores[0] += 0.004303; scores[1] += -0.001007; scores[2] += -0.003296; break;
      case 3: scores[0] += -0.005882; scores[1] += 0.003147; scores[2] += 0.002734; break;
      case 4: scores[0] += 0.005357; scores[1] += 0.000481; scores[2] += -0.005839; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.006066; scores[1] += 0.003776; scores[2] += 0.002290; break;
      case 7: scores[0] += -0.002401; scores[1] += 0.000551; scores[2] += 0.001850; break;
      case 8: scores[0] += 0.012943; scores[1] += 0.018338; scores[2] += -0.031281; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.007925; scores[1] += 0.006794; scores[2] += 0.001131; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += -0.005524; scores[1] += -0.000507; scores[2] += 0.006031; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.004745; scores[1] += -0.009417; scores[2] += 0.004671; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 494 (depth=4)
  {
    const leafIdx = ((features[22] > 0.5) << 0) | ((features[10] > 8.583333969116211) << 1) | ((features[10] > 8.291666030883789) << 2) | ((features[0] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.001272; scores[1] += -0.000236; scores[2] += 0.001508; break;
      case 1: scores[0] += -0.009688; scores[1] += 0.010376; scores[2] += -0.000688; break;
      case 2: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 3: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 4: scores[0] += -0.009697; scores[1] += -0.010393; scores[2] += 0.020090; break;
      case 5: scores[0] += -0.005466; scores[1] += 0.026393; scores[2] += -0.020927; break;
      case 6: scores[0] += -0.000032; scores[1] += 0.002469; scores[2] += -0.002437; break;
      case 7: scores[0] += -0.006407; scores[1] += -0.001399; scores[2] += 0.007806; break;
      case 8: scores[0] += -0.006490; scores[1] += -0.001832; scores[2] += 0.008322; break;
      case 9: scores[0] += -0.007086; scores[1] += -0.019973; scores[2] += 0.027059; break;
      case 10: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 11: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 12: scores[0] += 0.008151; scores[1] += 0.020131; scores[2] += -0.028282; break;
      case 13: scores[0] += 0.029789; scores[1] += -0.003535; scores[2] += -0.026253; break;
      case 14: scores[0] += 0.009396; scores[1] += -0.008543; scores[2] += -0.000853; break;
      case 15: scores[0] += 0.011931; scores[1] += -0.010248; scores[2] += -0.001682; break;
    }
  }

  // Tree 495 (depth=4)
  {
    const leafIdx = ((features[44] > 0.25) << 0) | ((features[35] > 0.5) << 1) | ((features[13] > 0.1026315838098526) << 2) | ((features[40] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.006948; scores[1] += -0.007794; scores[2] += 0.000846; break;
      case 1: scores[0] += -0.022221; scores[1] += 0.034780; scores[2] += -0.012559; break;
      case 2: scores[0] += -0.018578; scores[1] += 0.001751; scores[2] += 0.016828; break;
      case 3: scores[0] += -0.003429; scores[1] += -0.024912; scores[2] += 0.028341; break;
      case 4: scores[0] += 0.002893; scores[1] += 0.004283; scores[2] += -0.007175; break;
      case 5: scores[0] += 0.008219; scores[1] += -0.006219; scores[2] += -0.002000; break;
      case 6: scores[0] += -0.000478; scores[1] += 0.020007; scores[2] += -0.019529; break;
      case 7: scores[0] += -0.005093; scores[1] += 0.015443; scores[2] += -0.010350; break;
      case 8: scores[0] += 0.001188; scores[1] += -0.004130; scores[2] += 0.002942; break;
      case 9: scores[0] += 0.006980; scores[1] += -0.004823; scores[2] += -0.002157; break;
      case 10: scores[0] += 0.020399; scores[1] += -0.004222; scores[2] += -0.016178; break;
      case 11: scores[0] += -0.006110; scores[1] += 0.017699; scores[2] += -0.011589; break;
      case 12: scores[0] += 0.004006; scores[1] += -0.008796; scores[2] += 0.004790; break;
      case 13: scores[0] += -0.016857; scores[1] += 0.004656; scores[2] += 0.012201; break;
      case 14: scores[0] += -0.001948; scores[1] += -0.001145; scores[2] += 0.003094; break;
      case 15: scores[0] += 0.010205; scores[1] += -0.002813; scores[2] += -0.007391; break;
    }
  }

  // Tree 496 (depth=4)
  {
    const leafIdx = ((features[10] > 11.291666030883789) << 0) | ((features[10] > 10.416666030883789) << 1) | ((features[34] > 0.25) << 2) | ((features[33] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += 0.000127; scores[1] += -0.000813; scores[2] += 0.000685; break;
      case 1: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 2: scores[0] += 0.017973; scores[1] += -0.003744; scores[2] += -0.014229; break;
      case 3: scores[0] += -0.004427; scores[1] += -0.000126; scores[2] += 0.004553; break;
      case 4: scores[0] += 0.012539; scores[1] += -0.008019; scores[2] += -0.004520; break;
      case 5: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 6: scores[0] += -0.006985; scores[1] += 0.035933; scores[2] += -0.028947; break;
      case 7: scores[0] += -0.012019; scores[1] += -0.001232; scores[2] += 0.013251; break;
      case 8: scores[0] += -0.002201; scores[1] += 0.001801; scores[2] += 0.000399; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.017133; scores[1] += 0.014869; scores[2] += 0.002264; break;
      case 11: scores[0] += 0.005239; scores[1] += -0.009152; scores[2] += 0.003912; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 15: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
    }
  }

  // Tree 497 (depth=4)
  {
    const leafIdx = ((features[10] > 9.416666030883789) << 0) | ((features[9] > 1.5) << 1) | ((features[44] > 0.25) << 2) | ((features[22] > 0.5) << 3);
    switch (leafIdx) {
      case 0: scores[0] += -0.003948; scores[1] += -0.009064; scores[2] += 0.013012; break;
      case 1: scores[0] += 0.013840; scores[1] += 0.011299; scores[2] += -0.025139; break;
      case 2: scores[0] += -0.006654; scores[1] += 0.000091; scores[2] += 0.006563; break;
      case 3: scores[0] += -0.000012; scores[1] += -0.000772; scores[2] += 0.000784; break;
      case 4: scores[0] += -0.005913; scores[1] += 0.015151; scores[2] += -0.009239; break;
      case 5: scores[0] += 0.006388; scores[1] += -0.011490; scores[2] += 0.005102; break;
      case 6: scores[0] += 0.003089; scores[1] += -0.000859; scores[2] += -0.002230; break;
      case 7: scores[0] += -0.009967; scores[1] += 0.006010; scores[2] += 0.003957; break;
      case 8: scores[0] += 0.014286; scores[1] += -0.006505; scores[2] += -0.007782; break;
      case 9: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 10: scores[0] += -0.001495; scores[1] += 0.027686; scores[2] += -0.026191; break;
      case 11: scores[0] += -0.005229; scores[1] += -0.002740; scores[2] += 0.007970; break;
      case 12: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 13: scores[0] += 0.000000; scores[1] += 0.000000; scores[2] += 0.000000; break;
      case 14: scores[0] += -0.002834; scores[1] += 0.002441; scores[2] += 0.000394; break;
      case 15: scores[0] += 0.002267; scores[1] += -0.006924; scores[2] += 0.004657; break;
    }
  }

  // Find winning class
  let maxIdx = 0;
  let maxScore = scores[0];
  for (let i = 1; i < 3; i++) {
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